module.exports = {
  env: {
    browser: true,
    es2021: true
  },
  root: true,
  extends: "airbnb-base",
  overrides: [],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  rules: {
    "max-len": ["error", { code: 120 }],
    "no-underscore-dangle": ["error", { "allowAfterThis": true }],
    "import/no-unresolved": 0, // Turn off "Unable to resolve path to module ..." error
    "import/extensions": 0, // Turn off "Missing file extension for ..." error
    "class-methods-use-this": 0,
  },
  ignorePatterns: ["node_modules", "src/dist", "docs", "tools"],
  settings: {}
};
