/**
 * Clipboard and Web Share helpers with fallback support for mobile and non-HTTPS
 * local network contexts where `navigator.clipboard` may be unavailable.
 */

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined' || !text) {
    return false;
  }

  try {
    if (window.isSecureContext !== false && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy textarea copy fallback
  }

  if (typeof document === 'undefined' || !document.body) {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';

  try {
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
  }
}

export interface RoomInviteSharePayload {
  roomTitle: string;
  roomCode: string;
  url: string;
}

export async function shareOrCopyInvite({
  roomTitle,
  roomCode,
  url,
}: RoomInviteSharePayload): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: `${roomTitle} · Syncora`,
        text: `Join my Syncora watch room (${roomCode})`,
        url,
      });
      return 'shared';
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'cancelled';
      }
      // Fall back to clipboard copy when Web Share rejects (e.g., unsupported context)
    }
  }

  const copied = await copyTextToClipboard(url);
  return copied ? 'copied' : 'failed';
}
