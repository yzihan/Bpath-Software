# Xslide

An application that can quickly view large images like .tif, .svs, .bif, .hdpi, .vms and .mrxs file(s).

[Download](https://github.com/hurryhuang1007/Xslide/releases)

## Screenshot

![init](./screenshot/init.jpg)

![viewer-1](./screenshot/viewer-1.jpg)

![viewer-2](./screenshot/viewer-2.jpg)

![viewer-3](./screenshot/viewer-3.jpg)

## Credits

Xslide would not exist without them:

[libvips](https://libvips.github.io/libvips/)
- A fast image processing library with low memory needs.

[electron](https://electronjs.org/)
- Build cross platform desktop apps with JavaScript, HTML, and CSS

## TODO

[ ] adapt MacOS

[ ] adapt Linux

## 说明
首先在./Client下运行`yarn`，并在./Electron下运行`npm install`，以安装依赖。

第一步： ./Client 下为网页代码，修改完毕后在 ./Client 下命令行运行npm run build，会在./Electron/render 下生成打包好的网页
第二步： ./Electron 下为生成可运行程序的代码，运行完第一步后，在./Electron 下命令行运行npm run dist，会在./Electron/dist下生成安装包

此项目使用的是Node.js v10，版本不对会出错。并且可能在运行时出现依赖包报错，这时候去package.json里面升级一下出错的包的版本应该就行了。

如果想要打开调试模式，在启动时添加环境变量`ELECTRON_IS_DEV=1`