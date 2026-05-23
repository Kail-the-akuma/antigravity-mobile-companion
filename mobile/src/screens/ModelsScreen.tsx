import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Switch,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';
import { ApiService } from '../services/api';

interface ModelQuota {
  name: string;
  remainingSegments: number;
  totalSegments: number;
  refreshTime: string;
  isDepleted: boolean;
}

interface ModelsScreenProps {
  onBack: () => void;
}

export const ModelsScreen: React.FC<ModelsScreenProps> = ({ onBack }) => {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [availableCredits, setAvailableCredits] = useState(18);
  const [enableOverages, setEnableOverages] = useState(true);
  const [modelQuotas, setModelQuotas] = useState<ModelQuota[]>([]);

  const fetchQuotaData = async (showRefreshIndicator = false) => {
    if (showRefreshIndicator) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await ApiService.getModelsQuota();
      if (data) {
        setAvailableCredits(data.availableCredits ?? 18);
        setEnableOverages(data.enableOverages ?? false);
        setModelQuotas(data.modelQuotas ?? []);
      }
    } catch (err: any) {
      console.error('[ModelsScreen] Failed to load models quota:', err);
      Alert.alert(
        'Erro ao Carregar',
        'Não foi possível ligar ao Daemon para atualizar as quotas. Por favor, tente novamente.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchQuotaData();
  }, []);

  const handleToggleOverages = async (newValue: boolean) => {
    // Optimistically update UI state for maximum responsiveness
    setEnableOverages(newValue);
    try {
      const res = await ApiService.setCreditOverages(newValue);
      if (!res || !res.success) {
        throw new Error('Backend failed to confirm update.');
      }
    } catch (err) {
      console.error('[ModelsScreen] Error saving overage toggle:', err);
      // Revert in case of failure
      setEnableOverages(!newValue);
      Alert.alert('Erro', 'Não foi possível alterar as definições no Daemon.');
    }
  };

  const handleActivityPress = () => {
    Alert.alert(
      'Faturação no PC',
      'A atividade de créditos detalhada e o histórico de faturas estão disponíveis no painel de controlo principal no seu computador.'
    );
  };

  const handleGetCreditsPress = () => {
    Alert.alert(
      'Adquirir Créditos',
      'A aquisição e gestão de créditos de IA são realizadas de forma segura através da aplicação de ambiente de trabalho (PC).'
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>A obter quotas de modelos reais...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.innerContainer, { paddingTop: Math.max(insets.top, 16) }]}>
        {/* HEADER SECTION */}
        <View style={styles.headerRow}>
          <View style={styles.headerTextGroup}>
            <Text style={styles.title}>Models</Text>
            <Text style={styles.subtitle}>Configure AI models and view your quota.</Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => fetchQuotaData(true)}
            disabled={refreshing}
            activeOpacity={0.7}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.refreshBtnText}>Refresh</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* MODEL CREDITS CARD */}
          <Text style={styles.sectionHeading}>Model Credits</Text>
          <View style={styles.card}>
            <View style={styles.overagesRow}>
              <View style={styles.overagesTextCol}>
                <Text style={styles.cardLabel}>Enable AI Credit Overages</Text>
                <Text style={styles.cardSubtext}>
                  When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits.
                </Text>
              </View>
              <View style={styles.toggleCol}>
                <Switch
                  trackColor={{ false: '#3A3A3C', true: Colors.primary }}
                  thumbColor={Platform.OS === 'android' ? '#FFF' : undefined}
                  ios_backgroundColor="#3A3A3C"
                  onValueChange={handleToggleOverages}
                  value={enableOverages}
                />
              </View>
            </View>

            <View style={styles.cardDivider} />

            <View style={styles.creditsRow}>
              <View style={styles.creditsLeft}>
                <Text style={styles.creditsText}>Available AI Credits: {availableCredits}</Text>
              </View>
              <View style={styles.creditsButtons}>
                <TouchableOpacity
                  style={styles.activityBtn}
                  onPress={handleActivityPress}
                  activeOpacity={0.7}
                >
                  <Text style={styles.activityBtnText}>See Activity</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.getCreditsBtn}
                  onPress={handleGetCreditsPress}
                  activeOpacity={0.7}
                >
                  <Text style={styles.getCreditsBtnText}>Get More AI Credits</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* MODEL QUOTAS SECTION */}
          <Text style={styles.sectionHeading}>Model Quota</Text>
          <View style={styles.quotasListCard}>
            {modelQuotas.map((item, index) => {
              // Render segment progress capsules
              const segments = [];
              for (let i = 0; i < item.totalSegments; i++) {
                const isFilled = i < item.remainingSegments;
                segments.push(
                  <View
                    key={i}
                    style={[
                      styles.segmentBar,
                      isFilled ? styles.segmentFilled : styles.segmentEmpty,
                    ]}
                  />
                );
              }

              return (
                <View
                  key={item.name}
                  style={[
                    styles.quotaRow,
                    index === modelQuotas.length - 1 ? styles.quotaRowLast : null,
                  ]}
                >
                  <View style={styles.quotaHeaderRow}>
                    <View style={styles.quotaTitleRow}>
                      <Text style={styles.modelNameText} numberOfLines={1} ellipsizeMode="tail">
                        {item.name}
                      </Text>
                      {item.isDepleted && <Text style={styles.warningIcon}>⚠️</Text>}
                    </View>
                    <Text style={styles.refreshLabelText}>{item.refreshTime}</Text>
                  </View>
                  <View style={styles.segmentsContainer}>{segments}</View>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* BACK FOOTER ACTION BUTTON */}
        <TouchableOpacity style={[styles.backButton, { marginBottom: Math.max(insets.bottom, 16) }]} onPress={onBack} activeOpacity={0.8}>
          <Text style={styles.backButtonText}>Voltar às Configurações</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  innerContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 0 : 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textMuted,
    marginTop: 12,
    fontSize: 14,
    fontWeight: '500',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  headerTextGroup: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  refreshBtn: {
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  sectionHeading: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 12,
  },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  overagesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  overagesTextCol: {
    flex: 0.82,
  },
  cardLabel: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  cardSubtext: {
    color: Colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 6,
  },
  toggleCol: {
    flex: 0.15,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingTop: 4,
  },
  cardDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 16,
  },
  creditsRow: {
    flexDirection: 'column',
    gap: 12,
  },
  creditsLeft: {
    justifyContent: 'center',
  },
  creditsText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  creditsButtons: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  activityBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#3A3A3C',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  activityBtnText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  getCreditsBtn: {
    flex: 1.3,
    backgroundColor: '#007AFF', // Clean iOS blue
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  getCreditsBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  quotasListCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  quotaRow: {
    flexDirection: 'column',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  quotaRowLast: {
    borderBottomWidth: 0,
  },
  quotaHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  quotaTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 8,
  },
  modelNameText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  warningIcon: {
    fontSize: 13,
    marginLeft: 6,
  },
  segmentsContainer: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 2,
  },
  segmentBar: {
    width: 26,
    height: 6,
    borderRadius: 3,
  },
  segmentFilled: {
    backgroundColor: '#E5E5EA', // Off-white segment
  },
  segmentEmpty: {
    backgroundColor: '#2C2C2E', // Sleek dark segment
  },
  refreshLabelText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'right',
  },
  backButton: {
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
  },
  backButtonText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
