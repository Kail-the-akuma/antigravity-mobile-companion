import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { Colors } from '../theme/colors';

export interface FileChange {
  component: string;
  action: 'NEW' | 'MODIFY' | 'DELETE';
  fileName: string;
  filePath: string;
}

export interface PlanComment {
  section: string;
  author: string;
  text: string;
}

export interface PlanData {
  goal?: string;
  reviewRequired?: string;
  openQuestions?: string;
  proposedChanges?: FileChange[];
  verificationPlan?: string;
  comments?: PlanComment[];
}

interface PlanReviewerProps {
  visible: boolean;
  onClose: () => void;
  planData: PlanData | null;
  loading: boolean;
  postingComment: boolean;
  onPostComment: (section: string, text: string) => Promise<void>;
  activeApproval: any;
  onRespondApproval: (status: 'Approved' | 'Rejected') => void;
  processingApproval?: boolean;
}

export const PlanReviewer: React.FC<PlanReviewerProps> = React.memo(({
  visible,
  onClose,
  planData,
  loading,
  postingComment,
  onPostComment,
  activeApproval,
  onRespondApproval,
  processingApproval = false,
}) => {
  // Accordion expanded states
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    Goal: true, // Expand Goal by default
    'User Review Required': true,
    'Open Questions': true,
    files: false,
    'Verification Plan': false,
    general: true,
  });

  // Nested files accordion expanded states (key is fileName)
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  // Local inputs state per section (key is section key)
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const toggleSection = useCallback((sectionKey: string) => {
    setExpandedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  }, []);

  const toggleFile = useCallback((fileName: string) => {
    setExpandedFiles((prev) => ({ ...prev, [fileName]: !prev[fileName] }));
  }, []);

  const handleInputChange = useCallback((sectionKey: string, text: string) => {
    setInputs((prev) => ({ ...prev, [sectionKey]: text }));
  }, []);

  const submitComment = async (sectionKey: string) => {
    const text = inputs[sectionKey]?.trim();
    if (!text) return;

    try {
      await onPostComment(sectionKey, text);
      // Clear input on success
      setInputs((prev) => ({ ...prev, [sectionKey]: '' }));
    } catch (err: any) {
      // Error handling is managed by parent, but we keep input intact
    }
  };

  // Render comments inside a section
  const renderCommentsList = (sectionKey: string) => {
    const list = planData?.comments?.filter((c) => c.section === sectionKey) || [];
    
    return (
      <View style={styles.commentsContainer}>
        {list.length > 0 && (
          <View style={styles.commentsList}>
            {list.map((c, i) => (
              <View key={i} style={styles.commentItem}>
                <View style={styles.commentHeader}>
                  <Text style={styles.commentAuthor}>{c.author}</Text>
                </View>
                <Text style={styles.commentText}>{c.text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Local Composer inside this section */}
        <View style={styles.localComposer}>
          <TextInput
            style={styles.localInput}
            placeholder="Escreva um comentário neste contexto..."
            placeholderTextColor={Colors.textMuted}
            value={inputs[sectionKey] || ''}
            onChangeText={(txt) => handleInputChange(sectionKey, txt)}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            style={[styles.localSubmitBtn, !inputs[sectionKey]?.trim() && styles.localSubmitBtnDisabled]}
            disabled={!inputs[sectionKey]?.trim() || postingComment}
            onPress={() => submitComment(sectionKey)}
          >
            {postingComment ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.localSubmitText}>Enviar</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const getCommentCount = (sectionKey: string) => {
    return planData?.comments?.filter((c) => c.section === sectionKey).length || 0;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Revisão do Plano</Text>
              <Text style={styles.modalSubtitle}>IDE Sidebar Mode</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.7}>
              <Text style={styles.closeButtonText}>Fechar</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>A ler plano de alterações...</Text>
            </View>
          ) : (
            <ScrollView 
              style={{ flex: 1 }} 
              contentContainerStyle={styles.scrollBody}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
              {/* SECTION 1: Objetivo */}
              <View style={styles.accordionCard}>
                <TouchableOpacity 
                  style={styles.accordionHeader} 
                  onPress={() => toggleSection('Goal')}
                  activeOpacity={0.7}
                >
                  <View style={styles.titleRow}>
                    <Text style={styles.emojiPrefix}>🎯</Text>
                    <Text style={styles.accordionTitle}>Objetivo</Text>
                  </View>
                  <View style={styles.rightRow}>
                    {getCommentCount('Goal') > 0 && (
                      <View style={styles.commentBadge}>
                        <Text style={styles.commentBadgeText}>{getCommentCount('Goal')}</Text>
                      </View>
                    )}
                    <Text style={styles.arrowIcon}>{expandedSections.Goal ? '▲' : '▼'}</Text>
                  </View>
                </TouchableOpacity>
                {expandedSections.Goal && (
                  <View style={styles.accordionContent}>
                    <Text style={styles.bodyText}>{planData?.goal || 'Nenhum objetivo fornecido.'}</Text>
                    <View style={styles.separator} />
                    {renderCommentsList('Goal')}
                  </View>
                )}
              </View>

              {/* SECTION 2: User Review Required */}
              {planData?.reviewRequired ? (
                <View style={[styles.accordionCard, styles.alertBorder]}>
                  <TouchableOpacity 
                    style={styles.accordionHeader} 
                    onPress={() => toggleSection('User Review Required')}
                    activeOpacity={0.7}
                  >
                    <View style={styles.titleRow}>
                      <Text style={styles.emojiPrefix}>⚠️</Text>
                      <Text style={[styles.accordionTitle, { color: Colors.danger }]}>Revisão Crítica</Text>
                    </View>
                    <View style={styles.rightRow}>
                      {getCommentCount('User Review Required') > 0 && (
                        <View style={styles.commentBadge}>
                          <Text style={styles.commentBadgeText}>{getCommentCount('User Review Required')}</Text>
                        </View>
                      )}
                      <Text style={[styles.arrowIcon, { color: Colors.danger }]}>
                        {expandedSections['User Review Required'] ? '▲' : '▼'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {expandedSections['User Review Required'] && (
                    <View style={styles.accordionContent}>
                      <View style={styles.alertContentContainer}>
                        <Text style={styles.alertText}>{planData.reviewRequired}</Text>
                      </View>
                      <View style={styles.separator} />
                      {renderCommentsList('User Review Required')}
                    </View>
                  )}
                </View>
              ) : null}

              {/* SECTION 3: Open Questions */}
              {planData?.openQuestions ? (
                <View style={[styles.accordionCard, styles.questionBorder]}>
                  <TouchableOpacity 
                    style={styles.accordionHeader} 
                    onPress={() => toggleSection('Open Questions')}
                    activeOpacity={0.7}
                  >
                    <View style={styles.titleRow}>
                      <Text style={styles.emojiPrefix}>❓</Text>
                      <Text style={[styles.accordionTitle, { color: Colors.warning }]}>Perguntas Abertas</Text>
                    </View>
                    <View style={styles.rightRow}>
                      {getCommentCount('Open Questions') > 0 && (
                        <View style={styles.commentBadge}>
                          <Text style={styles.commentBadgeText}>{getCommentCount('Open Questions')}</Text>
                        </View>
                      )}
                      <Text style={[styles.arrowIcon, { color: Colors.warning }]}>
                        {expandedSections['Open Questions'] ? '▲' : '▼'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {expandedSections['Open Questions'] && (
                    <View style={styles.accordionContent}>
                      <Text style={styles.bodyText}>{planData.openQuestions}</Text>
                      <View style={styles.separator} />
                      {renderCommentsList('Open Questions')}
                    </View>
                  )}
                </View>
              ) : null}

              {/* SECTION 4: Proposed Changes (Files) */}
              <View style={styles.accordionCard}>
                <TouchableOpacity 
                  style={styles.accordionHeader} 
                  onPress={() => toggleSection('files')}
                  activeOpacity={0.7}
                >
                  <View style={styles.titleRow}>
                    <Text style={styles.emojiPrefix}>📁</Text>
                    <Text style={styles.accordionTitle}>Ficheiros a Alterar</Text>
                  </View>
                  <View style={styles.rightRow}>
                    <Text style={styles.arrowIcon}>{expandedSections.files ? '▲' : '▼'}</Text>
                  </View>
                </TouchableOpacity>
                {expandedSections.files && (
                  <View style={styles.accordionContent}>
                    {planData?.proposedChanges && planData.proposedChanges.length > 0 ? (
                      planData.proposedChanges.map((file, idx) => {
                        const isNew = file.action === 'NEW';
                        const isDelete = file.action === 'DELETE';
                        const badgeBg = isNew ? 'rgba(48, 209, 88, 0.15)' : isDelete ? 'rgba(255, 69, 58, 0.15)' : 'rgba(255, 159, 10, 0.15)';
                        const badgeText = isNew ? Colors.success : isDelete ? Colors.danger : Colors.warning;
                        const isFileExpanded = !!expandedFiles[file.fileName];

                        return (
                          <View key={idx} style={styles.fileAccordion}>
                            <TouchableOpacity 
                              style={styles.fileAccordionHeader}
                              onPress={() => toggleFile(file.fileName)}
                              activeOpacity={0.8}
                            >
                              <View style={styles.fileLeftInfo}>
                                <Text style={styles.filePath} numberOfLines={1}>{file.fileName}</Text>
                                <Text style={styles.fileComponent}>{file.component}</Text>
                                <View style={[styles.actionBadge, { backgroundColor: badgeBg }]}>
                                  <Text style={[styles.actionText, { color: badgeText }]}>{file.action}</Text>
                                </View>
                              </View>
                              <View style={styles.rightRow}>
                                {getCommentCount(file.fileName) > 0 && (
                                  <View style={styles.commentBadge}>
                                    <Text style={styles.commentBadgeText}>{getCommentCount(file.fileName)}</Text>
                                  </View>
                                )}
                                <Text style={styles.fileArrowIcon}>{isFileExpanded ? '▲' : '▼'}</Text>
                              </View>
                            </TouchableOpacity>

                            {isFileExpanded && (
                              <View style={styles.fileAccordionContent}>
                                <Text style={styles.fileSubtext}>Caminho: {file.filePath}</Text>
                                <View style={styles.fileSeparator} />
                                {renderCommentsList(file.fileName)}
                              </View>
                            )}
                          </View>
                        );
                      })
                    ) : (
                      <Text style={styles.emptyAccordionText}>Nenhum ficheiro registado no plano.</Text>
                    )}
                  </View>
                )}
              </View>

              {/* SECTION 5: Verification Plan */}
              {planData?.verificationPlan ? (
                <View style={styles.accordionCard}>
                  <TouchableOpacity 
                    style={styles.accordionHeader} 
                    onPress={() => toggleSection('Verification Plan')}
                    activeOpacity={0.7}
                  >
                    <View style={styles.titleRow}>
                      <Text style={styles.emojiPrefix}>🧪</Text>
                      <Text style={styles.accordionTitle}>Verificação</Text>
                    </View>
                    <View style={styles.rightRow}>
                      {getCommentCount('Verification Plan') > 0 && (
                        <View style={styles.commentBadge}>
                          <Text style={styles.commentBadgeText}>{getCommentCount('Verification Plan')}</Text>
                        </View>
                      )}
                      <Text style={styles.arrowIcon}>{expandedSections['Verification Plan'] ? '▲' : '▼'}</Text>
                    </View>
                  </TouchableOpacity>
                  {expandedSections['Verification Plan'] && (
                    <View style={styles.accordionContent}>
                      <Text style={styles.bodyText}>{planData.verificationPlan}</Text>
                      <View style={styles.separator} />
                      {renderCommentsList('Verification Plan')}
                    </View>
                  )}
                </View>
              ) : null}

              {/* SECTION 6: General Discussion */}
              <View style={styles.accordionCard}>
                <TouchableOpacity 
                  style={styles.accordionHeader} 
                  onPress={() => toggleSection('general')}
                  activeOpacity={0.7}
                >
                  <View style={styles.titleRow}>
                    <Text style={styles.emojiPrefix}>💬</Text>
                    <Text style={styles.accordionTitle}>Discussão Geral</Text>
                  </View>
                  <View style={styles.rightRow}>
                    {getCommentCount('general') > 0 && (
                      <View style={styles.commentBadge}>
                        <Text style={styles.commentBadgeText}>{getCommentCount('general')}</Text>
                      </View>
                    )}
                    <Text style={styles.arrowIcon}>{expandedSections.general ? '▲' : '▼'}</Text>
                  </View>
                </TouchableOpacity>
                {expandedSections.general && (
                  <View style={styles.accordionContent}>
                    {renderCommentsList('general')}
                  </View>
                )}
              </View>
            </ScrollView>
          )}

          {/* Bottom Actions if active approval request is pending */}
          {activeApproval && (
            <View style={styles.bottomActions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.rejectBtn]}
                onPress={() => onRespondApproval('Rejected')}
                disabled={processingApproval}
              >
                <Text style={styles.rejectText}>Rejeitar Plano</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.approveBtn]}
                onPress={() => onRespondApproval('Approved')}
                disabled={processingApproval}
              >
                {processingApproval ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.approveText}>Aprovar Plano</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 15, 17, 0.85)',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: '15%',
    flex: 1,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
  },
  modalSubtitle: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  closeButton: {
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  closeButtonText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  scrollBody: {
    padding: 16,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
    marginTop: 12,
  },
  
  // Accordion Card styles
  accordionCard: {
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  alertBorder: {
    borderColor: 'rgba(255, 69, 58, 0.3)',
    backgroundColor: 'rgba(255, 69, 58, 0.03)',
  },
  questionBorder: {
    borderColor: 'rgba(255, 159, 10, 0.3)',
    backgroundColor: 'rgba(255, 159, 10, 0.03)',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emojiPrefix: {
    fontSize: 18,
    marginRight: 10,
  },
  accordionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  arrowIcon: {
    fontSize: 12,
    color: Colors.textMuted,
    marginLeft: 10,
  },
  accordionContent: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  bodyText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 14,
  },

  // Alert Text Inside Accordion
  alertContentContainer: {
    backgroundColor: 'rgba(255, 69, 58, 0.08)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.danger,
    padding: 12,
    borderRadius: 6,
  },
  alertText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },

  // Nested Files styles
  fileAccordion: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 8,
    overflow: 'hidden',
  },
  fileAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  fileLeftInfo: {
    flex: 1,
    marginRight: 10,
  },
  filePath: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '600',
  },
  fileComponent: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  actionText: {
    fontSize: 9,
    fontWeight: '800',
  },
  fileArrowIcon: {
    fontSize: 11,
    color: Colors.textMuted,
    marginLeft: 8,
  },
  fileAccordionContent: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  fileSubtext: {
    fontSize: 11,
    color: Colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  fileSeparator: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 10,
  },
  emptyAccordionText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
  commentBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 4,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 18,
  },
  commentBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
  },

  // Contextual Comments inside sections
  commentsContainer: {
    marginTop: 4,
  },
  commentsList: {
    marginBottom: 12,
  },
  commentItem: {
    backgroundColor: Colors.surface,
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  commentAuthor: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  commentText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },

  // Local Section Composers
  localComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  localInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: Colors.text,
    fontSize: 13,
    maxHeight: 70,
    marginRight: 8,
  },
  localSubmitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-end',
    justifyContent: 'center',
  },
  localSubmitBtnDisabled: {
    opacity: 0.4,
  },
  localSubmitText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },

  // Bottom action buttons inside the overlay footer
  bottomActions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtn: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    marginRight: 8,
  },
  approveBtn: {
    backgroundColor: Colors.success,
  },
  rejectText: {
    color: Colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
  approveText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
