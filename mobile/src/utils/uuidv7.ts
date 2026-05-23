import * as Crypto from 'expo-crypto';

/**
 * Gera um identificador único universal versão 7 (UUID v7) em conformidade com o RFC 9562.
 * Utiliza o timestamp Unix com precisão de milissegundos (bits 0-47) e entropia criptográfica 
 * segura do expo-crypto (bits 48-127), assegurando ordenação lexicográfica e temporal estrita.
 * 
 * Formato retornado: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx (onde 'y' é 8, 9, a ou b)
 */
export function generateUuidV7(): string {
  const timestamp = Date.now();
  const randomBytes = Crypto.getRandomBytes(10); // 10 bytes = 80 bits de entropia

  // 1. Representar o timestamp em 12 caracteres hexadecimais (48 bits)
  const hexTime = timestamp.toString(16).padStart(12, '0');

  // 2. Estruturar os bits de versão (ver = 7) nos 4 bits superiores do grupo
  // rand_a (12 bits): Usamos os primeiros 2 bytes mascarados com 0x0FFF
  const randAVal = ((randomBytes[0] << 8) | randomBytes[1]) & 0x0fff;
  const verAndRand = ((7 << 12) | randAVal).toString(16).padStart(4, '0');

  // 3. Estruturar os bits de variante (var = 2, binário 10) nos 2 bits superiores do grupo y
  // rand_b (62 bits): Usamos os restantes 8 bytes.
  const variantByte = (randomBytes[2] & 0x3f) | 0x80; // Força bits 6 e 7 superiores como 10 (variante 2)
  const randBVal1 = variantByte.toString(16).padStart(2, '0');
  const randBVal2 = Array.from(randomBytes.slice(3, 10))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // 4. Agrupar em yxxx-xxxxxxxxxxxx (4 caracteres do grupo y e 12 caracteres do grupo final)
  const yGroup = `${randBVal1}${randBVal2.slice(0, 2)}`;
  const finalGroup = randBVal2.slice(2);

  // Formato final UUID
  return `${hexTime.slice(0, 8)}-${hexTime.slice(8, 12)}-${verAndRand}-${yGroup}-${finalGroup}`;
}
