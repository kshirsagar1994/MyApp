module.exports = function (api) {
  api.cache(true);
  const plugins = [];

  // ── PERFORMANCE: Strip all console.* calls in production builds
  // Prevents JS thread blocking from synchronous console.log I/O
  // and reduces GC pressure from string allocations
  if (process.env.NODE_ENV === 'production') {
    plugins.push('transform-remove-console');
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
