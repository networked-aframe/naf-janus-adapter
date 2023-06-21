const path = require("path");

module.exports = {
  entry: path.join(__dirname, "src", "index"),
  output: {
    filename: "naf-janus-adapter.js",
    path: path.resolve(__dirname, "dist"),
    publicPath: '/dist/'
  },
  module: {
    rules: [
      {
        test: /.js$/,
        include: [path.resolve(__dirname, "src")],
        exclude: [path.resolve(__dirname, "node_modules")],
        use: {
          loader: "babel-loader"
        }
      }
    ]
  },
  resolve: {
    extensions: [".js"]
  }
};
