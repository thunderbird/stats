/**
 * Returns tooltip options for various financial charts
 * @returns {{mode: string, intersect: boolean, callbacks: {label: (function(*): string), title: (function(*): *[])}}}
 */
export const getFinancialTooltipOptions = () => ({
  mode: 'index',
  callbacks: {
    label: (context) => {
      const yValue = context.parsed.y;
      const label = context.dataset.label || null;

      const currencyFormatted = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
      }).format(yValue);

      return [label, currencyFormatted].filter((x) => x).join(': ');
    },
  },
});

/**
 * Returns options for formatting financial-related y axis data
 * @returns {{y: {ticks: {callback: (function(*, *, *): string)}}}}
 */
export const getFinancialScalesOptions = () => ({
  y: {
    ticks: {
      // Include a dollar sign in the ticks
      callback: (value) => new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
      }).format(value),
    },
  },
});
