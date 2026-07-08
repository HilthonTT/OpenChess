export type ToastVariant = "success" | "error" | "info";

export type ToastOptions = {
  message: string;
  variant?: ToastVariant;
  duration?: number;
};

/** How long a toast stays visible, in milliseconds. */
export const DEFAULT_DURATION = 3000;
export const DEFAULT_VARIANT: ToastVariant = "info";
