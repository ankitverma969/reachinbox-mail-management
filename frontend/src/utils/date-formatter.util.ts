/**
 * Dynamic Date Formatting Utility
 * Formats email activity and schedule dates dynamically based on current time.
 */

export function parseDateSafe(dateInput?: string | Date | null): Date | null {
  if (!dateInput) return null;
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formats a scheduled future date dynamically.
 * e.g. "Today 9:15:12 AM", "Tomorrow 10:00:00 AM", "Tue 9:15:12 AM", "Nov 3 10:23:00 AM"
 */
export function formatDynamicScheduledDate(dateInput?: string | Date | null): string {
  const date = parseDateSafe(dateInput);
  if (!date) return 'Not scheduled';

  const now = new Date();
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

  // Reset hours to compare calendar days
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((targetStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today ${timeStr}`;
  }
  if (diffDays === 1) {
    return `Tomorrow ${timeStr}`;
  }
  if (diffDays > 1 && diffDays < 7) {
    const weekday = date.toLocaleDateString([], { weekday: 'short' });
    return `${weekday} ${timeStr}`;
  }

  const monthDay = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (date.getFullYear() === now.getFullYear()) {
    return `${monthDay} ${timeStr}`;
  }

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} ${timeStr}`;
}

/**
 * Formats a sent activity timestamp dynamically.
 * e.g. "Just now", "5m ago", "2h ago", "Yesterday, 4:15 PM", "Oct 22, 10:23 AM"
 */
export function formatDynamicSentDate(dateInput?: string | Date | null): string {
  const date = parseDateSafe(dateInput);
  if (!date) return 'Pending';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffMinutes < 1) {
    return 'Just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24 && now.getDate() === date.getDate()) {
    return `${diffHours}h ago`;
  }

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayStart.getTime() - targetStart.getTime()) / (1000 * 60 * 60 * 24));

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

  if (diffDays === 1) {
    return `Yesterday, ${timeStr}`;
  }

  const monthDay = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (date.getFullYear() === now.getFullYear()) {
    return `${monthDay}, ${timeStr}`;
  }

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}, ${timeStr}`;
}

/**
 * Formats full timestamp for detail views and headers.
 * e.g. "Thu, Oct 23, 2026, 10:23 AM"
 */
export function formatDetailFullDate(dateInput?: string | Date | null): string {
  const date = parseDateSafe(dateInput);
  if (!date) return 'No date recorded';

  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}
