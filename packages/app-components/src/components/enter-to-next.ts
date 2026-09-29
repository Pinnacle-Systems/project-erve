import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface EnterToNextOptions {
  /**
   * Whether to advance to the form's submit button after the last editable field.
   * If true, pressing Enter on the final field moves focus to the submit button
   * without activating it. Pressing Enter on the submit button itself will natively submit.
   * If false, focus remains on the final field and implicit submission is prevented.
   * Default: true
   */
  advanceToSubmit?: boolean;

  /**
   * Optional custom selector for eligible controls.
   */
  selector?: string;
}

export const DEFAULT_FORM_CONTROL_SELECTOR = [
  '[data-form-control]',
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):not([type="file"]):not([type="checkbox"]):not([type="radio"])',
  'select',
  'textarea',
  'button[role="combobox"]',
].join(', ');

function isJsdomEnv(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}

export function isControlVisible(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
    } catch {
      // Fallback to inline style
    }
  }
  if (el.style.display === 'none' || el.style.visibility === 'hidden') {
    return false;
  }
  if (!isJsdomEnv() && el.offsetParent === null && el.style.position !== 'fixed') {
    return false;
  }
  return true;
}

export function isEnterNavigationSource(target: HTMLElement): boolean {
  // 1. Textarea Enter MUST insert newline
  if (target.tagName === 'TEXTAREA') {
    return false;
  }

  // 2. Contenteditable preserves native behavior
  if (target.isContentEditable) {
    return false;
  }

  // 3. Buttons, links, and comboboxes retain native / widget semantics
  if (
    target.tagName === 'BUTTON' ||
    target.tagName === 'A' ||
    target.getAttribute('role') === 'button' ||
    target.getAttribute('role') === 'link' ||
    target.getAttribute('role') === 'combobox'
  ) {
    return false;
  }

  // 4. Disabled controls
  if (
    ('disabled' in target && (target as HTMLInputElement).disabled) ||
    target.getAttribute('aria-disabled') === 'true'
  ) {
    return false;
  }

  // 5. Read-only controls (skip for data-entry navigation)
  if (
    ('readOnly' in target && (target as HTMLInputElement).readOnly) ||
    target.getAttribute('aria-readonly') === 'true'
  ) {
    return false;
  }

  // 6. Hidden controls
  if (!isControlVisible(target)) {
    return false;
  }

  // 7. Non-text inputs (buttons, checkboxes, radios, file, hidden)
  if (target instanceof HTMLInputElement) {
    const nonNavTypes = ['button', 'submit', 'reset', 'image', 'file', 'checkbox', 'radio', 'hidden'];
    if (nonNavTypes.includes(target.type)) {
      return false;
    }
  }

  // 8. Specialized editors
  if (target.closest('[data-specialized-editor], [data-slate-editor], [data-monaco-editor]')) {
    return false;
  }

  // 9. Active popup interaction that owns Enter (e.g. open Combobox, open LookupField, open DatePicker calendar)
  if (
    target.getAttribute('aria-expanded') === 'true' ||
    target.closest('[aria-expanded="true"]') !== null ||
    target.closest('[role="listbox"], [role="menu"], [data-lookup-panel]') !== null
  ) {
    return false;
  }

  return true;
}

export function isEligibleDestination(el: HTMLElement, container: HTMLElement): boolean {
  // Not disabled
  if (
    ('disabled' in el && (el as HTMLInputElement).disabled) ||
    el.getAttribute('aria-disabled') === 'true'
  ) {
    return false;
  }

  // Not readOnly (skip read-only fields for accelerated data entry)
  if (
    ('readOnly' in el && (el as HTMLInputElement).readOnly) ||
    el.getAttribute('aria-readonly') === 'true'
  ) {
    return false;
  }

  // Must be visible
  if (!isControlVisible(el)) {
    return false;
  }

  // Must not be an incidental secondary button inside a composite control
  if (el.getAttribute('aria-label') === 'Open date picker calendar') {
    return false;
  }
  if (el.hasAttribute('data-radix-focus-guard')) {
    return false;
  }

  // Avoid controls explicitly excluded by tabIndex < 0 (unless marked as data-form-control)
  if (el.tabIndex < 0 && !el.hasAttribute('data-form-control')) {
    return false;
  }

  // Must not be inside an inert or hidden ancestor within the container
  if (el.closest('[hidden], [aria-hidden="true"]') && !container.closest('[aria-hidden="true"]')) {
    return false;
  }

  return true;
}

export function getFormDestinations(
  container: HTMLElement,
  options?: EnterToNextOptions
): HTMLElement[] {
  const selector = options?.selector ?? DEFAULT_FORM_CONTROL_SELECTOR;
  const rawElements = Array.from(container.querySelectorAll<HTMLElement>(selector));

  const destinations: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const el of rawElements) {
    if (!seen.has(el) && isEligibleDestination(el, container)) {
      seen.add(el);
      destinations.push(el);
    }
  }

  const advanceToSubmit = options?.advanceToSubmit ?? true;
  if (advanceToSubmit) {
    const submitButtons = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button[type="submit"]:not(:disabled), [data-form-submit]:not(:disabled)'
      )
    );
    for (const btn of submitButtons) {
      if (
        !seen.has(btn) &&
        !btn.hasAttribute('disabled') &&
        btn.getAttribute('aria-disabled') !== 'true' &&
        isControlVisible(btn)
      ) {
        seen.add(btn);
        destinations.push(btn);
        break; // Only include the primary submit button
      }
    }
  }

  return destinations;
}

export function handleEnterToNext(
  event: ReactKeyboardEvent<HTMLElement> | KeyboardEvent,
  options?: EnterToNextOptions
): void {
  // 1. Only Enter key
  if (event.key !== 'Enter') {
    return;
  }

  // 2. Ignore if already default-prevented
  if (event.defaultPrevented) {
    return;
  }

  // 3. Ignore native IME composition
  const nativeEv = 'nativeEvent' in event ? (event.nativeEvent as KeyboardEvent) : (event as KeyboardEvent);
  const isComposing =
    Boolean(nativeEv?.isComposing) ||
    ('isComposing' in event && Boolean((event as { isComposing?: boolean }).isComposing)) ||
    ('keyCode' in event && (event as { keyCode?: number }).keyCode === 229) ||
    ('keyCode' in nativeEv && (nativeEv as { keyCode?: number }).keyCode === 229);

  if (isComposing) {
    return;
  }

  // 4. Ignore modifier combinations (Ctrl, Alt, Meta, Shift)
  // Shift+Enter preserves normal semantics; reverse navigation remains standard Shift+Tab.
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
    return;
  }

  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }

  // 5. Must be an eligible navigation source
  if (!isEnterNavigationSource(target)) {
    return;
  }

  // 6. Find container
  const container =
    (event.currentTarget as HTMLElement | null) ||
    target.closest('form') ||
    target.closest('[data-enter-to-next-container]') ||
    (target.ownerDocument?.body ?? document.body);

  if (!container) {
    return;
  }

  // 7. Get fresh destinations from current DOM (never cached)
  const destinations = getFormDestinations(container, options);
  if (destinations.length === 0) {
    event.preventDefault();
    return;
  }

  // 8. Find index of target in destinations
  let currentIndex = destinations.indexOf(target);
  if (currentIndex === -1) {
    currentIndex = destinations.findIndex(
      (el) => el === target || el.contains(target)
    );
  }

  if (currentIndex >= 0 && currentIndex < destinations.length - 1) {
    const nextControl = destinations[currentIndex + 1];
    event.preventDefault(); // Suppress implicit form submission
    if (nextControl) {
      nextControl.focus();
    }
  } else {
    // Last field behavior:
    // Do NOT wrap back to first field.
    // Do NOT automatically submit.
    // Suppress implicit form submission and leave focus where it is.
    event.preventDefault();
  }
}

export function createEnterToNextHandler(options?: EnterToNextOptions) {
  return (event: ReactKeyboardEvent<HTMLElement>) => {
    handleEnterToNext(event, options);
  };
}

export function useEnterToNextField(options?: EnterToNextOptions) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  return useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    handleEnterToNext(event, optionsRef.current);
  }, []);
}
