import { useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";
import { Modal } from "./Modal";

// Botão que pede confirmação antes de ações destrutivas.
export function ConfirmButton({
  title,
  description,
  confirmLabel = "Confirmar",
  onConfirm,
  children,
  danger = true,
  ...buttonProps
}: Omit<ButtonProps, "onClick"> & {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown> | void;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={title}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant={danger ? "danger" : "primary"}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{description ?? "Esta ação não pode ser desfeita."}</p>
      </Modal>
    </>
  );
}
