const path = require("path");
const { merge } = require("webpack-merge");
const common = require("./webpack.common");

module.exports = merge(common, {
  mode: "development",
  devtool: "inline-source-map",
  devServer: {
    server: {
      type: 'https'
    },
    static: {
      directory: path.resolve(__dirname, "examples")
    }
  }
});
