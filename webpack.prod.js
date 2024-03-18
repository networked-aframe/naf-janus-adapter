const path = require("path");

module.exports = {
  extends: ['webpack.common.js'],
  mode: "production",
  output: {
    filename: "naf-janus-adapter.min.js"
  },
  devtool: "source-map"
};
