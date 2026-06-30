import {
  type ChangeEvent,
  forwardRef,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { ValidationMessage } from "./validation-message";

const datePickerFieldVariants = cva(
  [
    "flex w-full items-center gap-2 rounded-control border bg-surface-raised font-sans text-foreground",
    "ring-offset-background transition duration-150 ease-out",
    "focus-within:outline-none focus-within:ring-[length:var(--erp-focus-ring-width)] focus-within:ring-[var(--erp-focus-ring)] focus-within:ring-offset-[var(--erp-focus-ring-offset)]",
    "disabled:cursor-not-allowed disabled:border-[var(--erp-border-disabled)] disabled:bg-[var(--erp-form-field-disabled-bg)] disabled:text-[var(--erp-text-disabled)] disabled:opacity-[var(--erp-disabled-opacity)]",
  ].join(" "),
  {
    variants: {
      density: {
        compact: "h-7 px-2.5 text-xs rounded-[var(--erp-radius-sm)]",
        comfortable: "h-control px-[var(--erp-control-padding-x)] text-control rounded-control",
        touch: "h-11 px-5 text-base rounded-[var(--erp-radius-lg)]",
      },
      error: {
        true: "border-[var(--erp-form-field-error-border)] focus-visible:border-[var(--erp-form-field-error-border)]",
        false: "border-[var(--erp-form-field-border)] focus-visible:border-[var(--erp-form-field-focus-border)]",
      },
    },
    defaultVariants: {
      density: "comfortable",
      error: false,
    },
  },
);

const popoverClassName =
  "fixed z-50 w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-surface p-3 shadow-popover";

const dayButtonClassName = [
  "flex h-8 w-8 items-center justify-center rounded-sm text-sm text-foreground outline-none",
  "transition-colors duration-150 ease-out",
  "hover:bg-[var(--erp-surface-hover)] hover:text-foreground",
  "focus-visible:bg-[var(--erp-surface-hover)] focus-visible:text-foreground",
  "focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)]",
  "data-[today=true]:border data-[today=true]:border-[var(--erp-border-selected)]",
  "data-[selected=true]:bg-[var(--erp-surface-selected)] data-[selected=true]:text-foreground",
  "data-[selected=true]:hover:bg-[var(--erp-surface-selected-hover)]",
  "data-[selected=true]:focus-visible:bg-[var(--erp-surface-selected-hover)]",
  "disabled:pointer-events-none disabled:text-[var(--erp-text-disabled)] disabled:opacity-[var(--erp-disabled-opacity)]",
].join(" ");

const weekdayLabels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const monthFormatter = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
});
const displayFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const labelFormatter = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const monthNames = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(2025, month, 1)));

type PopoverPosition = {
  left: number;
  top: number;
};

type DateDisplayFormat = "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "short";

export interface DatePickerProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange">,
    Omit<VariantProps<typeof datePickerFieldVariants>, "error"> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  value?: string | Date;
  defaultValue?: string | Date;
  onValueChange?: (value: string | undefined) => void;
  displayFormat?: DateDisplayFormat;
}

function formatDateForInput(date: string | Date | undefined): string | undefined {
  if (!date) return undefined;
  if (typeof date === "string") return date;
  return date.toISOString().split("T")[0];
}

function parseInputDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return undefined;
  return createValidDate(year, month, day);
}

function createValidDate(year: number, month: number, day: number): Date | undefined {
  if (!year || !month || !day) return undefined;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date;
}

function toInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDate(a: Date | undefined, b: Date | undefined): boolean {
  return !!a && !!b && toInputDate(a) === toInputDate(b);
}

function isOutOfRange(date: Date, min: InputHTMLAttributes<HTMLInputElement>["min"], max: InputHTMLAttributes<HTMLInputElement>["max"]): boolean {
  const value = toInputDate(date);
  const minValue = typeof min === "string" ? min : undefined;
  const maxValue = typeof max === "string" ? max : undefined;

  return (!!minValue && value < minValue) || (!!maxValue && value > maxValue);
}

function toMonthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function formatDisplayDate(date: Date | undefined, displayFormat: DateDisplayFormat): string {
  if (!date) return "";
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  switch (displayFormat) {
    case "dd/mm/yyyy":
      return `${dd}/${mm}/${yyyy}`;
    case "mm/dd/yyyy":
      return `${mm}/${dd}/${yyyy}`;
    case "yyyy-mm-dd":
      return `${yyyy}-${mm}-${dd}`;
    case "short":
      return displayFormatter.format(date);
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

function parseTypedDate(value: string, displayFormat: DateDisplayFormat): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return createValidDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const month = displayFormat === "mm/dd/yyyy" ? first : second;
    const day = displayFormat === "mm/dd/yyyy" ? second : first;
    return createValidDate(year, month, day);
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return createValidDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  return undefined;
}

function isCompleteTypedDate(value: string): boolean {
  const trimmed = value.trim();
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed) || /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(trimmed) || /[a-z]/i.test(trimmed);
}

function getCalendarDays(monthDate: Date): Date[] {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function getDateLabel(date: Date, isToday: boolean, isSelected: boolean, isDisabled: boolean): string {
  return [
    labelFormatter.format(date),
    isToday ? "today" : undefined,
    isSelected ? "selected" : undefined,
    isDisabled ? "unavailable" : undefined,
  ].filter(Boolean).join(", ");
}

export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
  (
    {
      className,
      density,
      error,
      label,
      description,
      id,
      required,
      value,
      defaultValue,
      onValueChange,
      disabled,
      displayFormat = "dd/mm/yyyy",
      placeholder,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const popoverId = `${inputId}-popover`;
    const descId = description ? `${inputId}-description` : undefined;
    const isControlled = value !== undefined;
    const initialValue = formatDateForInput(defaultValue);
    const [uncontrolledValue, setUncontrolledValue] = useState<string | undefined>(initialValue);
    const selectedValue = formatDateForInput(value) ?? uncontrolledValue;
    const selectedDate = parseInputDate(selectedValue);
    const selectedDisplayValue = formatDisplayDate(selectedDate, displayFormat);
    const [draftValue, setDraftValue] = useState(selectedDisplayValue);
    const [draftError, setDraftError] = useState<string | undefined>();
    const [isOpen, setIsOpen] = useState(false);
    const [visibleMonth, setVisibleMonth] = useState<Date>(selectedDate ?? new Date());
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dayRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>({ left: 0, top: 0 });
    const days = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);
    const today = parseInputDate(toInputDate(new Date()));
    const todayDisabled = today ? isOutOfRange(today, props.min, props.max) : true;
    const headingId = `${inputId}-heading`;
    const validationError = error ?? draftError;
    const errorId = validationError ? `${inputId}-error` : undefined;
    const ariaDescribedBy = [errorId, descId, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
    const isDraftDirty = draftValue !== selectedDisplayValue;
    const normalizedSubmitValue = draftError || isDraftDirty ? "" : selectedValue ?? "";
    const effectivePlaceholder = placeholder ?? displayFormat;
    const minDate = typeof props.min === "string" ? parseInputDate(props.min) : undefined;
    const maxDate = typeof props.max === "string" ? parseInputDate(props.max) : undefined;
    const minYear = minDate?.getFullYear() ?? visibleMonth.getFullYear() - 10;
    const maxYear = maxDate?.getFullYear() ?? visibleMonth.getFullYear() + 10;
    const yearOptions = Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index);
    const canMoveToMonth = (offset: number) => {
      const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
      const nextMonthIndex = toMonthIndex(nextMonth);
      const minMonthIndex = minDate ? toMonthIndex(minDate) : undefined;
      const maxMonthIndex = maxDate ? toMonthIndex(maxDate) : undefined;

      return (minMonthIndex === undefined || nextMonthIndex >= minMonthIndex) && (maxMonthIndex === undefined || nextMonthIndex <= maxMonthIndex);
    };
    const canMovePreviousYear = canMoveToMonth(-12);
    const canMovePreviousMonth = canMoveToMonth(-1);
    const canMoveNextMonth = canMoveToMonth(1);
    const canMoveNextYear = canMoveToMonth(12);

    useEffect(() => {
      if (selectedDate) {
        setVisibleMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
      }
    }, [selectedValue]);

    useEffect(() => {
      setDraftValue(selectedDisplayValue);
      setDraftError(undefined);
    }, [selectedDisplayValue]);

    const updatePopoverPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const popoverWidth = Math.min(320, window.innerWidth - 32);
      const left = Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - popoverWidth - 16));
      setPopoverPosition({ left, top: rect.bottom + 4 });
    };

    const closePopover = (restoreFocus = true) => {
      setIsOpen(false);
      if (restoreFocus) {
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };

    const getFocusableDayIndex = (preferredDate?: Date) => {
      const preferredIndex = preferredDate
        ? days.findIndex((day) => isSameDate(day, preferredDate) && day.getMonth() === visibleMonth.getMonth() && !isOutOfRange(day, props.min, props.max))
        : -1;

      if (preferredIndex >= 0) return preferredIndex;
      const todayIndex = today
        ? days.findIndex((day) => isSameDate(day, today) && day.getMonth() === visibleMonth.getMonth() && !isOutOfRange(day, props.min, props.max))
        : -1;
      if (todayIndex >= 0) return todayIndex;

      return days.findIndex((day) => day.getMonth() === visibleMonth.getMonth() && !isOutOfRange(day, props.min, props.max));
    };

    const focusDay = (index: number) => {
      const normalizedIndex = Math.min(Math.max(index, 0), days.length - 1);
      const target = dayRefs.current[normalizedIndex];
      if (!target || target.disabled) return;
      target.focus();
    };

    const findFocusableDayIndex = (startIndex: number, step: number) => {
      for (let index = startIndex; index >= 0 && index < days.length; index += step) {
        const target = dayRefs.current[index];
        if (target && !target.disabled) return index;
      }
      return -1;
    };

    const focusInitialDay = () => {
      window.requestAnimationFrame(() => {
        const targetIndex = getFocusableDayIndex(selectedDate);
        if (targetIndex >= 0) {
          focusDay(targetIndex);
        }
      });
    };

    const openPopover = (focusCalendar = false) => {
      updatePopoverPosition();
      setIsOpen(true);
      if (focusCalendar) {
        focusInitialDay();
      }
    };

    useLayoutEffect(() => {
      if (isOpen) {
        updatePopoverPosition();
      }
    }, [isOpen]);

    useEffect(() => {
      if (!isOpen) return;

      const onPointerDown = (event: MouseEvent) => {
        if (!rootRef.current?.contains(event.target as Node)) {
          closePopover(false);
        }
      };
      const onKeyDown = (event: globalThis.KeyboardEvent) => {
        if (event.key === "Escape") {
          closePopover();
        }
      };
      const onPositionChange = () => updatePopoverPosition();

      document.addEventListener("mousedown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
      window.addEventListener("resize", onPositionChange);
      window.addEventListener("scroll", onPositionChange, true);
      return () => {
        document.removeEventListener("mousedown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("resize", onPositionChange);
        window.removeEventListener("scroll", onPositionChange, true);
      };
    }, [isOpen, days, props.max, props.min, selectedDate, today, visibleMonth]);

    const setDateValue = (nextValue: string | undefined) => {
      if (!isControlled) {
        setUncontrolledValue(nextValue);
      }
      onValueChange?.(nextValue);
    };

    const moveMonth = (offset: number) => {
      if (!canMoveToMonth(offset)) return;
      setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
    };

    const moveYear = (offset: number) => {
      if (!canMoveToMonth(offset * 12)) return;
      setVisibleMonth((current) => new Date(current.getFullYear() + offset, current.getMonth(), 1));
    };

    const handleMonthChange = (event: ChangeEvent<HTMLSelectElement>) => {
      const nextMonth = Number(event.target.value);
      setVisibleMonth((current) => new Date(current.getFullYear(), nextMonth, 1));
    };

    const handleYearChange = (event: ChangeEvent<HTMLSelectElement>) => {
      const nextYear = Number(event.target.value);
      setVisibleMonth((current) => new Date(nextYear, current.getMonth(), 1));
    };

    const selectDate = (date: Date) => {
      if (isOutOfRange(date, props.min, props.max)) return;
      const nextValue = toInputDate(date);
      setDraftValue(formatDisplayDate(date, displayFormat));
      setDraftError(undefined);
      setDateValue(nextValue);
      closePopover();
    };

    const validateAndCommitTypedDate = (nextDraftValue: string) => {
      const trimmed = nextDraftValue.trim();
      if (!trimmed) {
        setDraftError(undefined);
        setDateValue(undefined);
        return;
      }

      const parsedDate = parseTypedDate(trimmed, displayFormat);
      if (!parsedDate) {
        if (isCompleteTypedDate(trimmed)) {
          setDraftError(`Enter a valid date in ${displayFormat} format.`);
        } else {
          setDraftError(undefined);
        }
        return;
      }

      if (isOutOfRange(parsedDate, props.min, props.max)) {
        setDraftError("Date is outside the allowed range.");
        return;
      }

      setDraftError(undefined);
      setVisibleMonth(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
      setDateValue(toInputDate(parsedDate));
    };

    const handleTextInputChange = (event: ChangeEvent<HTMLInputElement>) => {
      const nextDraftValue = event.target.value;
      setDraftValue(nextDraftValue);
      validateAndCommitTypedDate(nextDraftValue);
    };

    const handleTextInputBlur = () => {
      if (draftError) return;
      const parsedDate = parseTypedDate(draftValue, displayFormat);
      if (parsedDate) {
        setDraftValue(formatDisplayDate(parsedDate, displayFormat));
      }
    };

    const handleTextInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        openPopover(true);
      }
    };

    const handleCalendarButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPopover(true);
      }
    };

    const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const moveFocus = (nextIndex: number) => {
        event.preventDefault();
        const step = nextIndex < index ? -1 : 1;
        const targetIndex = findFocusableDayIndex(nextIndex, step);
        if (targetIndex >= 0) {
          focusDay(targetIndex);
        }
      };

      switch (event.key) {
        case "ArrowLeft":
          moveFocus(index - 1);
          break;
        case "ArrowRight":
          moveFocus(index + 1);
          break;
        case "ArrowUp":
          moveFocus(index - 7);
          break;
        case "ArrowDown":
          moveFocus(index + 7);
          break;
        case "Home":
          moveFocus(index - (index % 7));
          break;
        case "End":
          moveFocus(index + (6 - (index % 7)));
          break;
        case "PageUp":
          event.preventDefault();
          if (event.shiftKey) {
            moveYear(-1);
          } else {
            moveMonth(-1);
          }
          break;
        case "PageDown":
          event.preventDefault();
          if (event.shiftKey) {
            moveYear(1);
          } else {
            moveMonth(1);
          }
          break;
        default:
          break;
      }
    };

    const dateInput = (
      <div ref={rootRef} className="relative w-full">
        <input
          type="hidden"
          id={`${inputId}-value`}
          value={normalizedSubmitValue}
          required={required}
          disabled={disabled}
          {...props}
          readOnly
        />
        <div className={cn(datePickerFieldVariants({ density, error: !!validationError }), className)}>
          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            required={required}
            placeholder={effectivePlaceholder}
            value={draftValue}
            aria-describedby={ariaDescribedBy}
            aria-invalid={!!validationError}
            aria-controls={isOpen ? popoverId : undefined}
            onChange={handleTextInputChange}
            onBlur={handleTextInputBlur}
            onKeyDown={handleTextInputKeyDown}
            className="min-w-0 flex-1 bg-transparent text-inherit outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          <button
            ref={triggerRef}
            type="button"
            disabled={disabled}
            aria-label="Open date picker calendar"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-controls={popoverId}
            onClick={() => {
              if (isOpen) {
                closePopover(false);
              } else {
                openPopover();
              }
            }}
            onKeyDown={handleCalendarButtonKeyDown}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-[var(--erp-surface-hover)] hover:text-foreground focus-visible:bg-[var(--erp-surface-hover)] focus-visible:text-foreground focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] disabled:pointer-events-none disabled:text-[var(--erp-text-disabled)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M8 2v4" />
              <path d="M16 2v4" />
              <rect width="18" height="18" x="3" y="4" rx="2" />
              <path d="M3 10h18" />
            </svg>
          </button>
        </div>
        {isOpen && (
          <div
            id={popoverId}
            role="dialog"
            aria-modal="false"
            aria-labelledby={headingId}
            className={popoverClassName}
            style={{ left: popoverPosition.left, top: popoverPosition.top }}
          >
            <div className="mb-3 flex items-center justify-between gap-1.5">
              <button
                type="button"
                aria-label="Previous year"
                disabled={!canMovePreviousYear}
                className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-[var(--erp-surface-hover)] hover:text-foreground focus-visible:bg-[var(--erp-surface-hover)] focus-visible:text-foreground focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] disabled:pointer-events-none disabled:text-[var(--erp-text-disabled)] disabled:opacity-[var(--erp-disabled-opacity)]"
                onClick={() => moveYear(-1)}
              >
                <span aria-hidden="true">«</span>
              </button>
              <button
                type="button"
                aria-label="Previous month"
                disabled={!canMovePreviousMonth}
                className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-[var(--erp-surface-hover)] hover:text-foreground focus-visible:bg-[var(--erp-surface-hover)] focus-visible:text-foreground focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] disabled:pointer-events-none disabled:text-[var(--erp-text-disabled)] disabled:opacity-[var(--erp-disabled-opacity)]"
                onClick={() => moveMonth(-1)}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <div id={headingId} className="sr-only" aria-live="polite">
                {monthFormatter.format(visibleMonth)}
              </div>
              <select
                aria-label="Month"
                value={visibleMonth.getMonth()}
                onChange={handleMonthChange}
                className="h-8 min-w-0 rounded-sm border border-border bg-surface px-2 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-[var(--erp-surface-hover)] focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)]"
              >
                {monthNames.map((month, index) => (
                  <option key={month} value={index}>{month}</option>
                ))}
              </select>
              <select
                aria-label="Year"
                value={visibleMonth.getFullYear()}
                onChange={handleYearChange}
                className="h-8 rounded-sm border border-border bg-surface px-2 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-[var(--erp-surface-hover)] focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)]"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Next month"
                disabled={!canMoveNextMonth}
                className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-[var(--erp-surface-hover)] hover:text-foreground focus-visible:bg-[var(--erp-surface-hover)] focus-visible:text-foreground focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] disabled:pointer-events-none disabled:text-[var(--erp-text-disabled)] disabled:opacity-[var(--erp-disabled-opacity)]"
                onClick={() => moveMonth(1)}
              >
                <span aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                aria-label="Next year"
                disabled={!canMoveNextYear}
                className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-[var(--erp-surface-hover)] hover:text-foreground focus-visible:bg-[var(--erp-surface-hover)] focus-visible:text-foreground focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] disabled:pointer-events-none disabled:text-[var(--erp-text-disabled)] disabled:opacity-[var(--erp-disabled-opacity)]"
                onClick={() => moveYear(1)}
              >
                <span aria-hidden="true">»</span>
              </button>
            </div>
            <div role="grid" aria-labelledby={headingId} className="grid grid-cols-7 gap-1 text-center">
              {weekdayLabels.map((day) => (
                <div key={day} role="columnheader" className="py-1 text-xs font-medium text-muted-foreground">
                  {day}
                </div>
              ))}
              {days.map((day, index) => {
                const inCurrentMonth = day.getMonth() === visibleMonth.getMonth();
                const isSelected = isSameDate(day, selectedDate);
                const isToday = isSameDate(day, today);
                const isDisabled = !inCurrentMonth || isOutOfRange(day, props.min, props.max);
                const dayLabel = getDateLabel(day, isToday, isSelected, isDisabled);
                const focusableDayIndex = getFocusableDayIndex(selectedDate);
                return (
                  <button
                    key={toInputDate(day)}
                    ref={(node) => {
                      dayRefs.current[index] = node;
                    }}
                    type="button"
                    role="gridcell"
                    disabled={isDisabled}
                    tabIndex={index === focusableDayIndex ? 0 : -1}
                    data-selected={isSelected || undefined}
                    data-today={isToday || undefined}
                    aria-label={dayLabel}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    className={dayButtonClassName}
                    onClick={() => selectDate(day)}
                    onKeyDown={(event) => handleDayKeyDown(event, index)}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <button
                type="button"
                className="text-sm font-medium text-[var(--erp-text-link)] underline-offset-4 outline-none hover:underline focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)]"
                aria-label="Clear selected date"
                onClick={() => {
                  setDraftValue("");
                  setDraftError(undefined);
                  setDateValue(undefined);
                  closePopover();
                }}
              >
                Clear
              </button>
              <button
                type="button"
                disabled={todayDisabled}
                aria-label="Select today"
                className="text-sm font-medium text-[var(--erp-text-link)] underline-offset-4 outline-none hover:underline focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] disabled:pointer-events-none disabled:text-[var(--erp-text-disabled)] disabled:no-underline disabled:opacity-[var(--erp-disabled-opacity)]"
                onClick={() => {
                  if (today) selectDate(today);
                }}
              >
                Today
              </button>
            </div>
          </div>
        )}
      </div>
    );

    if (!label && !description && !validationError) {
      return dateInput;
    }

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-semibold text-foreground">
            {label}
            {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
          </label>
        )}
        {description && (
          <p id={descId} className="text-sm text-muted-foreground">{description}</p>
        )}
        {dateInput}
        {validationError && (
          <ValidationMessage id={errorId} tone="error">{validationError}</ValidationMessage>
        )}
      </div>
    );
  },
);
DatePicker.displayName = "DatePicker";
