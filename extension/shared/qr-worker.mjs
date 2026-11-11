// Runs jsQR off the page's thread for the decoder in qr-decoder.mjs.
import '../vendor/jsqr/jsQR.js';

const CORNERS = ['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'];

self.onmessage = ({ data: image }) => {
  try {
    const code = self.jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
    self.postMessage(code && {
      data: code.data,
      location: CORNERS.map((corner) => ({ x: code.location[corner].x, y: code.location[corner].y })),
    });
  } finally {
    image.data.fill(0);
  }
};
