// Only authenticator payloads count when scanning a page; other QR codes, such as links, are ignored.
export function isOtpPayload(text) {
  return typeof text === 'string' && /^\s*otpauth(-migration)?:\/\//i.test(text);
}

export function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// A region in CSS pixels as whole capture pixels, padded for the QR quiet zone and clamped; null when outside.
export function cropRect(region, scale, bounds, padding = 0.1) {
  const margin = padding * Math.max(region.width, region.height);
  const left = Math.max(0, Math.floor((region.x - margin) * scale));
  const top = Math.max(0, Math.floor((region.y - margin) * scale));
  const right = Math.min(bounds.width, Math.ceil((region.x + region.width + margin) * scale));
  const bottom = Math.min(bounds.height, Math.ceil((region.y + region.height + margin) * scale));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// The rectangle around the corners jsQR reports, in CSS pixels: scale is decoded pixels per CSS pixel and offset is
// where the decoded image starts. Corners a little outside the image are clamped, since the page takes no negatives.
export function cornersRect(corners, scale, offset = { x: 0, y: 0 }) {
  const xs = corners.map((point) => offset.x + point.x / scale);
  const ys = corners.map((point) => offset.y + point.y / scale);
  const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
  return { x, y, width: Math.max(0, Math.max(...xs) - x), height: Math.max(0, Math.max(...ys) - y) };
}
