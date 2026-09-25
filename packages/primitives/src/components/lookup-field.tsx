import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';
import { useResolvedDensity } from '../lib/density';
import type { Density } from '@erve/theme';

// Single-select searchable lookup: a textbox whose typing drives a (usually
// server-side) search, with a portalled listbox of the current matches.
//
// It is deliberately data-agnostic. The consumer owns the search text, runs
// the search, and passes back `options` plus their loading/error state. The
// current value is `selectedOption`, supplied independently of `options` —
// the selected record never has to appear in the current results, so an
// edit form can hydrate a saved (even since-retired) value directly.
//
// Keyboard: ArrowDown/ArrowUp move the highlight (ArrowDown also opens),
// Enter selects the highlighted option, Escape closes (a second Escape
// restores the selected value's text), Tab closes and moves on normally.
// Enter is only consumed while the list is open with a highlighted option or
// a search in flight — otherwise it propagates, so form-level Enter handling
// (submit today, Enter-to-Tab later) keeps working.

export type LookupFieldWidth = 'full' | 'fill' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const fieldWidthClasses: Record<LookupFieldWidth, string> = {
  full: 'w-full',
  fill: 'w-[var(--erp-size-intent-fill)]',
  xs: 'w-[var(--erp-control-width-xs)] max-w-full',
  sm: 'w-[var(--erp-control-width-sm)] max-w-full',
  md: 'w-[var(--erp-control-width-md)] max-w-full',
  lg: 'w-[var(--erp-control-width-lg)] max-w-full',
  xl: 'w-[var(--erp-control-width-xl)] max-w-full',
};

const inputDensityClasses: Record<Density, string> = {
  compact: 'h-8 pl-3 text-xs',
  comfortable: 'h-control pl-[var(--erp-control-padding-x)] text-control',
  touch: 'h-11 pl-4 text-base',
};

const optionDensityClasses: Record<Density, string> = {
  compact: 'py-1 text-xs',
  comfortable: 'py-1.5 text-sm',
  touch: 'py-2.5 text-base',
};

const PANEL_GAP = 4;
const VIEWPORT_GUTTER = 4;
const PANEL_MAX_HEIGHT = 320;
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 520;

export interface LookupFieldProps<T> {
  label?: string;
  'aria-label'?: string;
  id?: string;
  placeholder?: string;
  width?: LookupFieldWidth;
  density?: Density;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  helpText?: ReactNode;
  errorMessage?: string;
  error?: boolean;
  /** The current value, independent of the current search results. */
  selectedOption: T | null;
  /** Called with the chosen option, or null when the value is cleared. */
  onSelect: (option: T | null) => void;
  /** Controlled search text (what the user has typed since focusing). */
  searchText: string;
  onSearchTextChange: (text: string) => void;
  options: readonly T[];
  getOptionKey: (option: T) => string;
  /** Plain text shown in the textbox for the selected value. */
  getOptionLabel: (option: T) => string;
  renderOption?: (option: T) => ReactNode;
  /** A search for the current text is pending/in flight — `options` may be stale. */
  loading?: boolean;
  /** The search failed. */
  searchError?: string | null;
  /** Shown instead of results, e.g. while the text is below a minimum length. */
  prompt?: ReactNode;
  emptyMessage?: ReactNode;
  loadingMessage?: ReactNode;
}

export function LookupField<T>({
  label,
  'aria-label': ariaLabel,
  id,
  placeholder,
  width = 'md',
  density,
  disabled,
  readOnly,
  required,
  helpText,
  errorMessage,
  error,
  selectedOption,
  onSelect,
  searchText,
  onSearchTextChange,
  options,
  getOptionKey,
  getOptionLabel,
  renderOption,
  loading = false,
  searchError,
  prompt,
  emptyMessage = 'No matches',
  loadingMessage = 'Searching…',
}: LookupFieldProps<T>) {
  const resolvedDensity = useResolvedDensity(density);
  const generatedId = useId();
  const inputId =
    id ?? (label ? `lookup-${label.toLowerCase().replace(/\s+/g, '-')}` : `lookup-${generatedId}`);
  const listboxId = `${inputId}-listbox`;
  const statusId = `${inputId}-status`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const hasError = Boolean(error || errorMessage);
  const interactive = !disabled && !readOnly;

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  // "Editing" = the textbox shows the user's search text rather than the
  // selected value's label.
  const [isEditing, setIsEditing] = useState(false);
  // The user's arrow-key position, remembered only for the result set it was
  // made in (see highlightedIndex below).
  const [highlight, setHighlight] = useState({ resultKey: '', index: -1 });
  const [panelStyle, setPanelStyle] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  }>({ left: 0, top: 0, width: PANEL_MIN_WIDTH, maxHeight: PANEL_MAX_HEIGHT });

  const showResults = !prompt && !searchError;
  const resultsActive = showResults && !loading && options.length > 0;

  // A fresh, non-empty result set starts highlighted on its first match, so
  // "type LMIX, press Enter" selects the top match. While a search is
  // pending nothing is highlighted: Enter must never pick a stale row.
  const resultKey = options.map(getOptionKey).join('\u0000');
  const highlightedIndex = !resultsActive
    ? -1
    : highlight.resultKey === resultKey && highlight.index < options.length
      ? highlight.index
      : 0;
  const setHighlightedIndex = (index: number) => setHighlight({ resultKey, index });

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return;
    const optionElement = document.getElementById(`${inputId}-option-${highlightedIndex}`);
    optionElement?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightedIndex, inputId, isOpen]);

  const updatePanelPosition = () => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(
      Math.max(rect.width, Math.min(PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)),
      PANEL_MAX_WIDTH,
      viewportWidth - VIEWPORT_GUTTER * 2,
    );
    const left = Math.min(
      Math.max(VIEWPORT_GUTTER, rect.left),
      Math.max(VIEWPORT_GUTTER, viewportWidth - width - VIEWPORT_GUTTER),
    );
    const spaceBelow = viewportHeight - rect.bottom - PANEL_GAP - VIEWPORT_GUTTER;
    const spaceAbove = rect.top - PANEL_GAP - VIEWPORT_GUTTER;
    // Flip above only when below is cramped and above is genuinely roomier.
    if (spaceBelow < 160 && spaceAbove > spaceBelow) {
      setPanelStyle({
        left,
        bottom: viewportHeight - rect.top + PANEL_GAP,
        width,
        maxHeight: Math.min(PANEL_MAX_HEIGHT, spaceAbove),
      });
    } else {
      setPanelStyle({
        left,
        top: rect.bottom + PANEL_GAP,
        width,
        maxHeight: Math.min(PANEL_MAX_HEIGHT, Math.max(spaceBelow, 120)),
      });
    }
  };

  useLayoutEffect(() => {
    if (isOpen) updatePanelPosition();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPositionChange = () => updatePanelPosition();
    window.addEventListener('resize', onPositionChange);
    window.addEventListener('scroll', onPositionChange, true);
    return () => {
      window.removeEventListener('resize', onPositionChange);
      window.removeEventListener('scroll', onPositionChange, true);
    };
  }, [isOpen]);

  const selectedLabel = selectedOption ? getOptionLabel(selectedOption) : '';
  const displayValue = isEditing ? searchText : selectedLabel;

  const endEditing = () => {
    setIsOpen(false);
    setIsEditing(false);
    if (searchText !== '') onSearchTextChange('');
  };

  const commitOption = (option: T) => {
    endEditing();
    onSelect(option);
  };

  // Leaving the field (blur/Tab): an emptied textbox clears the value;
  // anything else half-typed is abandoned and the selected label returns.
  const commitOnLeave = () => {
    if (isEditing && searchText.trim() === '' && selectedOption) {
      onSelect(null);
    }
    endEditing();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!interactive) return;
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          return;
        }
        if (resultsActive) {
          setHighlightedIndex((highlightedIndex + 1) % options.length);
        }
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          return;
        }
        if (resultsActive) {
          setHighlightedIndex(highlightedIndex <= 0 ? options.length - 1 : highlightedIndex - 1);
        }
        return;
      }
      case 'Enter': {
        if (!isOpen) return;
        const highlighted = resultsActive ? options[highlightedIndex] : undefined;
        if (highlighted !== undefined) {
          event.preventDefault();
          commitOption(highlighted);
        } else if (isEditing && loading) {
          // A search for the typed text is still in flight — swallow this
          // one Enter rather than submitting the surrounding form with the
          // previous value. Transient: it propagates again once idle.
          event.preventDefault();
        }
        return;
      }
      case 'Escape': {
        if (isOpen) {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen(false);
          return;
        }
        if (isEditing) {
          event.preventDefault();
          event.stopPropagation();
          endEditing();
        }
        return;
      }
      case 'Tab': {
        // Never prevented — focus moves on normally.
        commitOnLeave();
        return;
      }
      default:
        return;
    }
  };

  const activeDescendant =
    isOpen && resultsActive && highlightedIndex >= 0
      ? `${inputId}-option-${highlightedIndex}`
      : undefined;

  let statusContent: ReactNode = null;
  if (prompt) statusContent = prompt;
  else if (searchError) statusContent = searchError;
  else if (loading && options.length === 0) statusContent = loadingMessage;
  else if (!loading && options.length === 0) statusContent = emptyMessage;

  const describedBy =
    [errorMessage ? errorId : helpText ? helpId : undefined].filter(Boolean).join(' ') || undefined;

  const clearButton =
    interactive && selectedOption && !isEditing ? (
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Clear ${label ?? ariaLabel ?? 'selection'}`}
        className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-xs text-muted-foreground hover:bg-[var(--erp-surface-hover)] hover:text-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onSelect(null);
          inputRef.current?.focus();
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    ) : null;

  return (
    <div data-width={width} className={cn('flex flex-col gap-1.5', fieldWidthClasses[width])}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-[var(--erp-form-label-color)] select-none leading-none"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-label={!label ? ariaLabel : undefined}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={activeDescendant}
          aria-invalid={hasError || undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          value={displayValue}
          // A long selected label truncates in the box; keep it readable on hover.
          title={!isEditing && selectedLabel ? selectedLabel : undefined}
          data-density={resolvedDensity}
          className={cn(
            'w-full truncate rounded-control border bg-surface-raised font-sans text-foreground pr-8',
            'placeholder:text-[var(--erp-color-foreground-subtle)]',
            'transition-colors duration-150 ease-out',
            'focus:outline-hidden focus:ring-[length:var(--erp-focus-ring-width)] focus:ring-[var(--erp-focus-ring)] focus:ring-offset-[var(--erp-focus-ring-offset)]',
            'disabled:pointer-events-none disabled:opacity-[var(--erp-disabled-opacity)] disabled:bg-[var(--erp-form-field-disabled-bg)] disabled:text-[var(--erp-text-disabled)] disabled:border-[var(--erp-border-disabled)]',
            'read-only:bg-[var(--erp-form-field-readonly-bg)] read-only:text-muted-foreground',
            hasError
              ? 'border-[var(--erp-form-field-error-border)] focus:border-[var(--erp-form-field-error-border)]'
              : 'border-[var(--erp-form-field-border)] focus:border-[var(--erp-form-field-focus-border)]',
            inputDensityClasses[resolvedDensity],
          )}
          onChange={(event) => {
            if (!interactive) return;
            setIsEditing(true);
            setIsOpen(true);
            onSearchTextChange(event.target.value);
          }}
          onClick={() => {
            if (!interactive || isOpen) return;
            setIsOpen(true);
          }}
          onFocus={(event) => {
            // Select the shown label so typing replaces it with a search.
            if (interactive && !isEditing) event.currentTarget.select();
          }}
          onBlur={() => {
            if (interactive) commitOnLeave();
          }}
          onKeyDown={handleKeyDown}
        />
        {clearButton}
      </div>
      {errorMessage && (
        <p
          id={errorId}
          className="text-xs text-[var(--erp-form-field-error-text-color)] leading-none"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
      {!errorMessage && helpText && (
        <p
          id={helpId}
          className="text-xs text-[var(--erp-form-field-help-text-color)] leading-none"
        >
          {helpText}
        </p>
      )}
      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            data-density={resolvedDensity}
            data-lookup-panel=""
            className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-border bg-surface shadow-popover"
            style={{
              left: panelStyle.left,
              top: panelStyle.top,
              bottom: panelStyle.bottom,
              width: panelStyle.width,
              maxHeight: panelStyle.maxHeight,
            }}
            // Keep focus in the textbox while clicking inside the panel, so
            // a click on an option is not preceded by a blur-commit.
            onMouseDown={(event) => event.preventDefault()}
          >
            <div
              id={statusId}
              role="status"
              aria-live="polite"
              className={cn(
                'px-3 text-muted-foreground',
                statusContent ? optionDensityClasses[resolvedDensity] : 'sr-only',
                searchError && 'text-[var(--erp-form-field-error-text-color)]',
              )}
            >
              {statusContent ??
                (loading
                  ? loadingMessage
                  : `${options.length} result${options.length === 1 ? '' : 's'}`)}
            </div>
            {showResults && options.length > 0 && (
              <ul
                id={listboxId}
                role="listbox"
                aria-label={label ?? ariaLabel}
                aria-busy={loading || undefined}
                className={cn('overflow-y-auto p-1', loading && 'opacity-60')}
              >
                {options.map((option, index) => {
                  const highlighted = resultsActive && index === highlightedIndex;
                  const isCurrent =
                    selectedOption !== null &&
                    getOptionKey(option) === getOptionKey(selectedOption);
                  return (
                    <li
                      key={getOptionKey(option)}
                      id={`${inputId}-option-${index}`}
                      role="option"
                      aria-selected={highlighted}
                      data-highlighted={highlighted || undefined}
                      data-current={isCurrent || undefined}
                      className={cn(
                        'cursor-default select-none rounded-xs px-2 text-foreground',
                        optionDensityClasses[resolvedDensity],
                        isCurrent && 'bg-[var(--erp-surface-selected)]',
                        highlighted &&
                          (isCurrent
                            ? 'bg-[var(--erp-surface-selected-hover)]'
                            : 'bg-[var(--erp-surface-hover)]'),
                      )}
                      onMouseMove={() => {
                        if (resultsActive && index !== highlightedIndex) setHighlightedIndex(index);
                      }}
                      onClick={() => {
                        if (!loading) commitOption(option);
                      }}
                    >
                      {renderOption ? renderOption(option) : getOptionLabel(option)}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
