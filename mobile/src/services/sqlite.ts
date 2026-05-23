import * as SQLite from 'expo-sqlite';

export interface LocalApprovalEvent {
  eventId: string;
  approvalId: string;
  nonce: string;
  action: 'Approved' | 'Rejected';
  timestampUtc: string;
  expiresAtUtc: string;
  signature: string;
  schemaVersion: number;
  syncAttempts: number;
}

export interface SucceededEvent {
  sequenceId: number;
  conversationId: string;
  eventType: string;
  payloadJson: string;
  timestamp: string;
}

class SQLiteService {
  private db: SQLite.SQLiteDatabase | null = null;

  /**
   * Abre e inicializa a base de dados SQLite local
   */
  public async initialize(): Promise<SQLite.SQLiteDatabase> {
    if (this.db) return this.db;

    try {
      // Abre a base de dados sincronamente (API padrão do expo-sqlite v15+)
      this.db = SQLite.openDatabaseSync('companion_local.db');
      console.log('[SQLiteService] Base de dados companion_local.db aberta com sucesso.');

      // Inicializa o esquema de tabelas atonicamente
      this.db.execSync(`
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS Metadata (
          key TEXT PRIMARY KEY,
          value TEXT
        );

        CREATE TABLE IF NOT EXISTS LocalAuthoritativeQueue (
          eventId TEXT PRIMARY KEY,
          approvalId TEXT NOT NULL,
          nonce TEXT NOT NULL,
          action TEXT NOT NULL,
          timestampUtc TEXT NOT NULL,
          expiresAtUtc TEXT NOT NULL,
          signature TEXT NOT NULL,
          schemaVersion INTEGER DEFAULT 1,
          syncAttempts INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS SucceededEvents (
          sequenceId INTEGER PRIMARY KEY,
          conversationId TEXT NOT NULL,
          eventType TEXT NOT NULL,
          payloadJson TEXT NOT NULL,
          timestamp TEXT NOT NULL
        );
      `);

      console.log('[SQLiteService] Tabelas de sistema validadas/criadas com sucesso.');
      return this.db;
    } catch (error) {
      console.error('[SQLiteService] Erro ao inicializar a base de dados SQLite:', error);
      throw error;
    }
  }

  private getDbSync(): SQLite.SQLiteDatabase {
    if (!this.db) {
      this.db = SQLite.openDatabaseSync('companion_local.db');
    }
    return this.db;
  }

  // ==========================================
  // METADATA - CHAVE VALOR (ATOMICIDADE)
  // ==========================================

  public async getMetadata(key: string): Promise<string | null> {
    const db = this.getDbSync();
    try {
      const row = await db.getFirstAsync<{ value: string }>(
        'SELECT value FROM Metadata WHERE key = ?',
        [key]
      );
      return row ? row.value : null;
    } catch (e) {
      console.error(`[SQLiteService] Erro ao obter metadata para key ${key}:`, e);
      return null;
    }
  }

  public async setMetadata(key: string, value: string): Promise<void> {
    const db = this.getDbSync();
    try {
      await db.runAsync(
        'INSERT INTO Metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value]
      );
    } catch (e) {
      console.error(`[SQLiteService] Erro ao gravar metadata para key ${key}:`, e);
      throw e;
    }
  }

  // ==========================================
  // LOCAL AUTHORITATIVE EVENT QUEUE
  // ==========================================

  /**
   * Enfileira um novo evento de aprovação na SQLite local de forma persistente
   */
  public async enqueueEvent(event: Omit<LocalApprovalEvent, 'syncAttempts'>): Promise<void> {
    const db = this.getDbSync();
    try {
      await db.runAsync(
        `INSERT INTO LocalAuthoritativeQueue 
         (eventId, approvalId, nonce, action, timestampUtc, expiresAtUtc, signature, schemaVersion, syncAttempts) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          event.eventId,
          event.approvalId,
          event.nonce,
          event.action,
          event.timestampUtc,
          event.expiresAtUtc,
          event.signature,
          event.schemaVersion
        ]
      );
      console.log(`[SQLiteService] Evento ${event.eventId} (Aprovação: ${event.approvalId}) enfileirado localmente.`);
    } catch (e) {
      console.error('[SQLiteService] Erro ao enfileirar evento:', e);
      throw e;
    }
  }

  /**
   * Obtém todos os eventos pendentes de sincronização ordenados cronologicamente (UUID v7 natural)
   */
  public async getPendingEvents(): Promise<LocalApprovalEvent[]> {
    const db = this.getDbSync();
    try {
      const rows = await db.getAllAsync<any>(
        'SELECT * FROM LocalAuthoritativeQueue ORDER BY eventId ASC'
      );
      return rows.map(r => ({
        eventId: r.eventId,
        approvalId: r.approvalId,
        nonce: r.nonce,
        action: r.action as 'Approved' | 'Rejected',
        timestampUtc: r.timestampUtc,
        expiresAtUtc: r.expiresAtUtc,
        signature: r.signature,
        schemaVersion: r.schemaVersion,
        syncAttempts: r.syncAttempts
      }));
    } catch (e) {
      console.error('[SQLiteService] Erro ao obter eventos pendentes da fila:', e);
      return [];
    }
  }

  /**
   * Remove um evento da fila local de forma atómica após ACK de sucesso
   */
  public async removeEvent(eventId: string): Promise<void> {
    const db = this.getDbSync();
    try {
      await db.runAsync(
        'DELETE FROM LocalAuthoritativeQueue WHERE eventId = ?',
        [eventId]
      );
      console.log(`[SQLiteService] Evento ${eventId} removido da fila local com sucesso.`);
    } catch (e) {
      console.error(`[SQLiteService] Erro ao remover evento ${eventId}:`, e);
      throw e;
    }
  }

  /**
   * Incrementa as tentativas de sincronização de um evento transiente
   */
  public async incrementAttempts(eventId: string): Promise<void> {
    const db = this.getDbSync();
    try {
      await db.runAsync(
        'UPDATE LocalAuthoritativeQueue SET syncAttempts = syncAttempts + 1 WHERE eventId = ?',
        [eventId]
      );
    } catch (e) {
      console.error(`[SQLiteService] Erro ao incrementar tentativas para ${eventId}:`, e);
    }
  }

  // ==========================================
  // SUCCEEDED EVENTS (DAEMON SYNCHRONIZATION)
  // ==========================================

  /**
   * Grava um conjunto de eventos sincronizados do Daemon atonicamente dentro de uma transação SQL
   */
  public async saveSucceededEvents(events: SucceededEvent[], lastId: number): Promise<void> {
    const db = this.getDbSync();
    
    // Executa a escrita atómica sob uma transação transacional SQLite
    try {
      await db.withTransactionAsync(async () => {
        for (const event of events) {
          await db.runAsync(
            `INSERT INTO SucceededEvents (sequenceId, conversationId, eventType, payloadJson, timestamp) 
             VALUES (?, ?, ?, ?, ?) 
             ON CONFLICT(sequenceId) DO UPDATE SET 
             conversationId = excluded.conversationId, 
             eventType = excluded.eventType, 
             payloadJson = excluded.payloadJson, 
             timestamp = excluded.timestamp`,
            [
              event.sequenceId,
              event.conversationId,
              event.eventType,
              event.payloadJson,
              event.timestamp
            ]
          );
        }

        // Atualiza o ponteiro de sincronização atonicamente no mesmo escopo
        await db.runAsync(
          "INSERT INTO Metadata (key, value) VALUES ('lastProcessedEventId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [lastId.toString()]
        );
      });
      console.log(`[SQLiteService] Gravados ${events.length} eventos e atualizado lastProcessedEventId para ${lastId}.`);
    } catch (e) {
      console.error('[SQLiteService] Erro na transação ao gravar eventos sincronizados:', e);
      throw e;
    }
  }

  /**
   * Obtém os eventos sucedidos de uma conversa ordenados de forma monotónica
   */
  public async getSucceededEvents(conversationId: string): Promise<SucceededEvent[]> {
    const db = this.getDbSync();
    try {
      const rows = await db.getAllAsync<any>(
        'SELECT * FROM SucceededEvents WHERE conversationId = ? ORDER BY sequenceId ASC',
        [conversationId]
      );
      return rows.map(r => ({
        sequenceId: r.sequenceId,
        conversationId: r.conversationId,
        eventType: r.eventType,
        payloadJson: r.payloadJson,
        timestamp: r.timestamp
      }));
    } catch (e) {
      console.error(`[SQLiteService] Erro ao ler eventos da conversa ${conversationId}:`, e);
      return [];
    }
  }
}

export const sqliteService = new SQLiteService();
