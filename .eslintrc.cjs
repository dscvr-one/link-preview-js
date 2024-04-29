module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es6: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    lib: ['es2022'],
    ecmaFeatures: {
      jsx: true,
      modules: true,
      experimentalObjectRestSpread: true,
    },
  },
  plugins: [
    '@typescript-eslint',
    'jsdoc',
    'security',
    'security-node',
    'anti-trojan-source',
    'prettier',
  ],
  extends: [
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:jsdoc/recommended',
    'plugin:security/recommended',
    'plugin:security-node/recommended',
    'plugin:anti-trojan-source/recommended',
    'plugin:prettier/recommended',
    'prettier',
  ],
  // add your custom rules here
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
  },
};
