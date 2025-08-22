module.exports = {
  root: true,
  // This tells ESLint to load the config from the package `eslint-config-microfox`
  extends: ['eslint-config-microfox'],
  settings: {
    next: {
      rootDir: ['apps/*/'],
    },
  },
};
