/**
 * Legacy fallback for copying text to clipboard.
 */
export function copyToClipboard(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
    return true;
  } catch (err) {
    console.error("Legacy copy failed:", err);
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
