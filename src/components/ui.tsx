import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';

/* -------------------------------- Button -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-surface hover:bg-ink/90 active:bg-ink/95 border border-transparent',
  secondary:
    'bg-surface text-ink border border-line-strong hover:border-ink/40 hover:bg-surface active:bg-elevated',
  ghost: 'bg-transparent text-dim border border-transparent hover:bg-elevated hover:text-ink',
  danger: 'bg-danger text-surface border border-transparent hover:bg-danger/90',
  soft: 'bg-clay-soft text-clay border border-transparent hover:bg-clay-soft/80',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-10 px-3.5 text-[13px] gap-1.5 rounded-[10px]',
  md: 'h-11 px-4 text-[14px] gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  full?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  full,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center font-medium transition-colors duration-150 focus-ring disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={size === 'sm' ? 16 : 18} /> : null}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: 'ghost' | 'secondary';
  size?: number;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 22,
  className = '',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors duration-150 focus-ring ${
        variant === 'secondary'
          ? 'border border-line-strong bg-surface text-ink hover:bg-elevated'
          : 'text-dim hover:bg-elevated hover:text-ink'
      } ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

/* --------------------------------- Card --------------------------------- */

export function Card({
  children,
  className = '',
  onClick,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  as?: 'div' | 'button';
}) {
  const base = `rounded-card border border-line bg-surface ${onClick ? 'w-full text-left transition-colors duration-150 hover:border-line-strong focus-ring' : ''} ${className}`;
  if (as === 'button' || onClick) {
    return (
      <button type="button" className={base} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <div className={base}>{children}</div>;
}

/* -------------------------------- Inputs -------------------------------- */

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-dim">
      {children}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-faint focus:border-ink/50 focus:outline-none ${className}`}
        {...rest}
      />
    );
  },
);

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full resize-none rounded-xl border border-line bg-surface p-3.5 text-[15px] leading-relaxed text-ink placeholder:text-faint focus:border-ink/50 focus:outline-none ${className}`}
      {...rest}
    />
  );
}

export function Select({
  className = '',
  children,
  value,
  onChange,
  id,
  disabled,
  'aria-label': ariaLabel,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false);
  const options: { value: string; label: string }[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: string | number; children?: ReactNode };
    const optionValue = String(props.value ?? '');
    options.push({ value: optionValue, label: String(props.children ?? optionValue) });
  });
  const current = options.find((option) => option.value === String(value ?? ''));

  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        title={current?.label}
        onClick={() => setOpen(true)}
        className={`flex h-12 min-w-0 w-full items-center gap-2 overflow-hidden rounded-xl border border-line bg-surface px-3.5 text-left text-[15px] text-ink transition-colors hover:border-line-strong focus-ring disabled:opacity-40 ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? '—'}</span>
        <Icon name="forward" size={16} className="shrink-0 rotate-90 text-faint" />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={ariaLabel ?? 'Выберите значение'}
      >
        <div role="listbox" className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {options.map((option) => {
            const active = option.value === current?.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setOpen(false);
                  onChange?.({ target: { value: option.value } } as ChangeEvent<HTMLSelectElement>);
                }}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] text-ink transition-colors hover:bg-elevated/60 focus-ring"
              >
                <span className="min-w-0 flex-1 break-words">{option.label}</span>
                {active ? <Icon name="check" size={18} className="shrink-0 text-clay" /> : null}
              </button>
            );
          })}
          {options.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-faint">Нет вариантов</p>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="mt-1.5 text-[12px] leading-snug text-faint">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------- Segmented ------------------------------ */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: { value: T; label: string; badge?: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex border-b border-line ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`relative flex h-11 flex-1 items-center justify-center gap-1.5 px-1 text-[13.5px] transition-colors duration-150 focus-ring ${
              active ? 'font-semibold text-ink' : 'font-normal text-faint hover:text-dim'
            }`}
          >
            {option.label}
            {option.badge ? (
              <span className={`tnum text-[11px] ${active ? 'text-clay' : 'text-faint'}`}>{option.badge}</span>
            ) : null}
            {active ? (
              <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-clay" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------- Switch -------------------------------- */

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <label
          htmlFor={id}
          onClick={(event) => {
            event.preventDefault();
            onChange(!checked);
          }}
          className="block cursor-pointer text-[15px] font-medium text-ink"
        >
          {label}
        </label>
        {description ? <p className="mt-0.5 text-[12.5px] leading-snug text-dim">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-[26px] w-[44px] shrink-0 rounded-full border transition-colors duration-200 focus-ring ${
          checked ? 'border-ink bg-ink' : 'border-line-strong bg-elevated'
        }`}
      >
        <span
          className={`absolute left-[2px] top-[2px] h-5 w-5 rounded-full bg-surface shadow-sm transition-transform duration-200 ease-sheet ${
            checked ? 'translate-x-[20px]' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

/* -------------------------------- Badge --------------------------------- */

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warn' | 'moss' | 'steel';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-elevated text-dim',
    accent: 'bg-clay-soft text-clay',
    success: 'bg-success-soft text-success',
    danger: 'bg-danger-soft text-danger',
    warn: 'bg-warn-soft text-warn',
    moss: 'bg-moss-soft text-moss',
    steel: 'bg-steel-soft text-steel',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------- Progress ------------------------------- */

export function Progress({
  value,
  tone = 'clay',
  thin,
}: {
  value: number;
  tone?: 'clay' | 'success' | 'danger' | 'warn' | 'ink';
  thin?: boolean;
}) {
  const colors = {
    clay: 'bg-clay',
    success: 'bg-success',
    danger: 'bg-danger',
    warn: 'bg-warn',
    ink: 'bg-ink',
  };
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={`w-full min-w-0 flex-1 overflow-hidden rounded-full bg-elevated ${thin ? 'h-1' : 'h-1.5'}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-sheet ${colors[tone]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/* ------------------------------ EmptyState ------------------------------ */

export function EmptyState({
  icon = 'info',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start px-5 py-8">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-line text-faint">
        <Icon name={icon} size={20} />
      </div>
      <p className="display text-[21px] leading-tight text-ink">{title}</p>
      {description ? (
        <p className="mt-2 max-w-[36ch] text-[13.5px] leading-relaxed text-dim">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* --------------------------------- Sheet -------------------------------- */

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute inset-0 bg-ink/45 fade-in"
      />
      <div className="sheet-in relative flex max-h-[92vh] w-full max-w-app flex-col overscroll-contain rounded-t-sheet border border-line bg-surface shadow-sheet safe-bottom">
        <div className="px-5 pb-4 pt-2.5">
          <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-line-strong" />
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-semibold leading-tight text-ink">{title}</h2>
              {description ? (
                <p className="mt-1 text-[12.5px] leading-snug text-dim">{description}</p>
              ) : null}
            </div>
            <IconButton icon="close" label="Закрыть" onClick={onClose} className="-mr-2 -mt-1" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer ? <div className="border-t border-line px-5 pb-4 pt-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------- Confirm ------------------------------- */

export function ConfirmSheet({
  open,
  title,
  description,
  confirmLabel = 'Удалить',
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" full onClick={onCancel}>
            Отмена
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} full onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-[13px] leading-relaxed text-dim">
        Действие нельзя отменить в интерфейсе. Данные можно восстановить только из полного бэкапа.
      </p>
    </Sheet>
  );
}

/* --------------------------------- Toast -------------------------------- */

type ToastTone = 'default' | 'success' | 'danger';
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

const ToastContext = createContext<
  (message: string, tone?: ToastTone, action?: ToastAction) => void
>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const timers = useRef<number[]>([]);

  const push = useCallback((message: string, tone: ToastTone = 'default', action?: ToastAction) => {
    const id = ++counter.current;
    setItems((current) => [...current.slice(-2), { id, message, tone, action }]);
    const timer = window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, action ? 6000 : 3200);
    timers.current.push(timer);
  }, []);

  useEffect(() => {
    const list = timers.current;
    return () => {
      list.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 toast-above-nav z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
          {items.map((item) => (
            <div
              key={item.id}
              className={`fade-in pointer-events-auto flex max-w-app items-center gap-3 rounded-full py-2.5 pl-4 pr-2 text-[12.5px] font-medium shadow-fab ${
                item.tone === 'danger' ? 'bg-danger text-surface' : 'bg-ink text-surface'
              }`}
              role="status"
            >
              <span>{item.message}</span>
              {item.action ? (
                <button
                  type="button"
                  onClick={() => {
                    item.action?.onClick();
                    setItems((current) => current.filter((entry) => entry.id !== item.id));
                  }}
                  className="shrink-0 rounded-full bg-surface/15 px-2.5 py-1 text-[12px] font-semibold underline-offset-2 hover:underline focus-ring"
                >
                  {item.action.label}
                </button>
              ) : null}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/* ---------------------------------- Row --------------------------------- */

export function Row({
  label,
  value,
  hint,
  onClick,
  right,
}: {
  label: string;
  value?: ReactNode;
  hint?: string;
  onClick?: () => void;
  right?: ReactNode;
}) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] text-ink">{label}</p>
        {hint ? <p className="mt-0.5 text-[12.5px] leading-snug text-faint">{hint}</p> : null}
      </div>
      {value != null ? <div className="shrink-0 text-[13px] tabular-nums text-dim">{value}</div> : null}
      {right ?? (onClick ? <Icon name="forward" size={17} className="shrink-0 text-faint" /> : null)}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-elevated/60 focus-ring"
      >
        {content}
      </button>
    );
  }
  return <div className="flex items-center gap-3 px-4 py-3.5">{content}</div>;
}

/* -------------------------------- Section ------------------------------- */

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between gap-3 px-0.5">
      <h2 className="text-[13px] font-medium text-dim">{children}</h2>
      {action}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export function FullPageLoader({ label = 'Загружаем данные…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-faint">
      <Spinner size={22} />
      <p className="text-[13px]">{label}</p>
    </div>
  );
}

/* ---------------------------------- FAB --------------------------------- */

export function Fab({
  icon = 'plus',
  label,
  onClick,
}: {
  icon?: IconName;
  label: string;
  onClick: () => void;
}) {
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 fab-above-nav z-20">
      <div className="mx-auto flex w-full max-w-app justify-end px-5">
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          title={label}
          className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-ink text-surface shadow-fab transition-transform duration-150 ease-sheet active:scale-95 focus-ring"
        >
          <Icon name={icon} size={25} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
