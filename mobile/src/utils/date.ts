export const formatTime = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    const now = new Date();
    
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 1) return 'Agora';
    if (diffMins < 60) return `Há ${diffMins} min`;
    if (diffHours < 24) return `Há ${diffHours} h`;
    
    return date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
};
