import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(num: number, precision = 2) {
  return num.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/**
 * Converts a data URL to a File object.
 * @param dataUrl The data URL to convert.
 * @param filename The desired filename for the output File.
 * @param mimeType The MIME type of the file.
 * @returns A Promise that resolves to a File object.
 */
export async function dataURLtoFile(dataUrl: string, filename: string, mimeType: string): Promise<File> {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: mimeType });
}
