const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    'content-script': './chrome-extension/content-script.js',
    'background': './chrome-extension/background.js',
    'popup': './chrome-extension/popup.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { 
          from: 'chrome-extension/manifest.json',
          to: 'manifest.json'
        },
        { 
          from: 'chrome-extension/popup.html',
          to: 'popup.html'
        },
        { 
          from: 'chrome-extension/styles.css',
          to: 'styles.css'
        },
        { 
          from: 'chrome-extension/netflix-api-bridge.js',
          to: 'netflix-api-bridge.js'
        },
        { 
          from: 'chrome-extension/images',
          to: 'images'
        }
      ]
    })
  ],
  resolve: {
    extensions: ['.js']
  },
  devtool: 'source-map',
  mode: 'development'
};
