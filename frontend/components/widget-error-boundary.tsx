'use client';

import { Component, ReactNode } from 'react';

/**
 * Bitta widget xato bersa ham butun sahifa yiqilmasligi uchun kichik ErrorBoundary.
 * Dashboard'dagi yangi widgetlar shu bilan o'raladi.
 */
export class WidgetErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; label?: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Konsolga yozamiz — sahifani yiqitmaymiz
    // eslint-disable-next-line no-console
    console.error('[WidgetErrorBoundary]', this.props.label || '', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded px-4 py-3 text-[12px] text-rose-600 dark:text-rose-400">
          {this.props.label ? `${this.props.label}: ` : ''}widget yuklashda xato (boshqa qismlar ishlayapti)
        </div>
      );
    }
    return this.props.children;
  }
}
