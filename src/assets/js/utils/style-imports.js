import buttonStylesheet from '../../css/button.css?inline';

/**
 * Returns a style element with a button import
 * @param {HTMLStyleElement} existingStyle
 * - If an existing style element is passed in, the button import will be appended to it.
 * @returns {HTMLStyleElement}
 */
// eslint-disable-next-line import/prefer-default-export
export const buttonStyle = (existingStyle = null) => {
  const style = existingStyle || document.createElement('style');
  style.innerHTML += ` ${buttonStylesheet} `;

  return style;
};
