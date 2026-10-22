import {
  Dialog,
  DialogContent,
  type DialogContentProps,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  ValidationMessage,
} from "@erve/primitives";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Mutation error, shown within the dialog so the user can retry or cancel. */
  error?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  onCloseAutoFocus?: DialogContentProps["onCloseAutoFocus"];
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  error,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  onCloseAutoFocus,
}: ConfirmDialogProps) => {
  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
        aria-busy={loading || undefined}
        onEscapeKeyDown={(event) => { if (loading) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (loading) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
          {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            density="comfortable"
            onClick={handleCancel}
            type="button"
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            density="comfortable"
            onClick={onConfirm}
            loading={loading}
            type="button"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

ConfirmDialog.displayName = "ConfirmDialog";
