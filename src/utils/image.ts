/**
 * Gets the camera stream for preview.
 */
export const getCameraStream = async (): Promise<MediaStream> => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera API not supported in this browser');
  }

  return await navigator.mediaDevices.getUserMedia({ 
    video: { 
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    } 
  });
};

/**
 * Captures a frame from a video element.
 */
export const captureFrame = (videoElement: HTMLVideoElement): string => {
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(videoElement, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
  }
  throw new Error('Could not get canvas context');
};

/**
 * Converts a base64 image to WebP format with size optimization.
 */
export const convertToLosslessWebP = async (base64Image: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      
      const MAX_DIM = 1600;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_DIM) {
          height *= MAX_DIM / width;
          width = MAX_DIM;
        }
      } else {
        if (height > MAX_DIM) {
          width *= MAX_DIM / height;
          height = MAX_DIM;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const webpData = canvas.toDataURL('image/webp', 0.8);
        resolve(webpData);
      } else {
        reject(new Error('Could not get canvas context'));
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for conversion'));
    img.src = base64Image;
  });
};

/**
 * Converts a File object to a Data URL (base64).
 */
export const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Enhances a base64 image for better OCR readability.
 */
export const enhanceImage = async (base64Image: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.filter = 'contrast(1.2) brightness(1.1)';
        ctx.drawImage(img, 0, 0);
        const enhancedData = canvas.toDataURL('image/webp', 0.85);
        resolve(enhancedData);
      } else {
        reject(new Error('Could not get canvas context'));
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for enhancement'));
    img.src = base64Image;
  });
};

/**
 * Crops and rotates a base64 image.
 */
export const cropImage = async (
  base64Image: string, 
  x: number, 
  y: number, 
  width: number, 
  height: number,
  rotation: number = 0
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      const rotRad = (rotation * Math.PI) / 180;
      // Calculate needed canvas size for rotation
      const { width: bWidth, height: bHeight } = getBoundingRect(image.width, image.height, rotation);
      
      canvas.width = bWidth;
      canvas.height = bHeight;

      ctx.translate(bWidth / 2, bHeight / 2);
      ctx.rotate(rotRad);
      ctx.drawImage(image, -image.width / 2, -image.height / 2);

      // Now create the final cropped canvas
      const croppedCanvas = document.createElement('canvas');
      const croppedCtx = croppedCanvas.getContext('2d');

      if (!croppedCtx) {
        reject(new Error('Could not get cropped canvas context'));
        return;
      }

      croppedCanvas.width = width;
      croppedCanvas.height = height;

      croppedCtx.drawImage(
        canvas,
        x,
        y,
        width,
        height,
        0,
        0,
        width,
        height
      );

      resolve(croppedCanvas.toDataURL('image/webp', 0.85));
    };
    image.onerror = () => reject(new Error('Failed to load image for cropping'));
    image.src = base64Image;
  });
};

function getBoundingRect(width: number, height: number, rotation: number) {
  const rad = (rotation * Math.PI) / 180;
  return {
    width: Math.abs(width * Math.cos(rad)) + Math.abs(height * Math.sin(rad)),
    height: Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad)),
  };
}
