const path = require("path");

module.exports = {
  extends: ['webpack.common.js'],
  mode: "development",
  devtool: "inline-source-map",
  devServer: {
    server: {
      type: "https",
    },
    proxy: [
      {
        context: ["/janus"],
        target: "http://127.0.0.1:8188/janus",
        ws: true,
      },
    ],
    static: {
      directory: path.resolve(__dirname, "examples"),
    },
  },
};
