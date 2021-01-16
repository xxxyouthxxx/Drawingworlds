"use strict";
// 首先，清理控制台
console.clear();
// 获取DOM元素
let body = document.body;
let authButton = document.getElementById('auth');
let authButtonText = document.getElementById('authButtonText');
let canvasContainer = document.getElementById('canvas');
let coolDownText = document.getElementById('cooldown-text');
let zoomInButton = document.getElementById('zoom-in');
let zoomOutButton = document.getElementById('zoom-out');
let colorOptions = [];
// 设置加载状态
body.classList.add('loading');
// 定义常量
const colors = ['ffffff',
    'e4e4e4',
    '888888',
    '222222',
    'ffa7d1',
    'e50000',
    'e59500',
    'a06a42',
    'e5d900',
    '94e044',
    '02be01',
    '00d3dd',
    '0083c7',
    '0000ea',
    'cf6ee4',
    '820080'
];
const gridSize = [1000, 1000];
const squareSize = [3, 3];
const coolDownTime = 500;
const zoomLevel = 6;
const clearColorSelectionOnCoolDown = false;
// 定义变量
let uid;
let app;
let graphics;
let gridLines;
let container;
let dragging = false;
let mouseDown = false;
let start;
let graphicsStart;
let selectedColor;
let zoomed = false;
let coolCount = 0;
let coolInterval;
let scale = 1;
let currentlyWriting;
let ready = false;
//我在开始下载所有像素前加了5秒，但前提是笔以缩略图预览的形式运行
//这样的话，我希望我的Firebase帐号不会占用宝贵的带宽。
let initWait = location.pathname.match(/fullcpgrid/i) ? 5000 : 0;
//安装firebase
var config = {
    apiKey: "AIzaSyA4q8u7hRWWGFq_fvTzMxpVypy7W4cTfTk",
    authDomain: "codepen-2.firebaseapp.com",
    databaseURL: "https://codepen-2.firebaseio.com",
    projectId: "codepen-2",
    storageBucket: "codepen-2.appspot.com",
    messagingSenderId: "270463661110"
};
firebase.initializeApp(config);
//检查用户是否已登录
firebase.auth().onAuthStateChanged(function (user) {
    if (user) {
        //用户已登录
        uid = user.uid;
        //设置注销按钮
        authButtonText.innerHTML = 'Logout';
        body.classList.add('logged-in');
        body.classList.remove('logged-out');
    }
    else {
        //用户未登录
        uid = null;
        //设置登陆按钮
        authButtonText.innerHTML = 'Login with Twitter';
        body.classList.remove('logged-in');
        body.classList.add('logged-out');
    }
    authButton.addEventListener("click", toggleLogin);
});
//运行阶段设置
setupStage();
setupColorOptions();
//开始检测新像素
setTimeout(startListeners, initWait);
//身份验证函数
function login() {
    // U使用推特登录
    var provider = new firebase.auth.TwitterAuthProvider();
    // 打开推特身份验证窗口
    firebase.auth().signInWithPopup(provider).catch(error => console.log('error logging in', error));
}
function logout() {
    firebase.auth().signOut().catch(error => console.error('error logging out', error));
}
function toggleLogin() {
    if (uid)
        logout();
    else
        login();
}
// 将像素写入数据库函数
function writePixel(x, y, color) {
    if (uid) {
        console.log('writing pixel...');
        //首先我们需要得到一个有效的时间戳。	时间戳：是一份能够表示一份数据在一个特定时间点已经存在的完整的可验证的数据
        // To stop spamming the rules on the database
        //阻止向数据库滥发控制
        //prevent creating a new timestamp within a set period.
        //防止在设置的时间段内创建新的时间戳
        getTimestamp().then(timestamp => {
            /// 我们成功地设置了一个新的时间戳。
            // 这意味着冷却期结束，用户可以自由地将新像素保存到数据库中
            var data = {
                uid: uid,
                timestamp: timestamp,
                color: color
            };
            currentlyWriting = x + 'x' + y;
            // 我们用“XxY”键设置新的像素数据
            //例如 "56x93"
            var ref = firebase.database().ref('pixel/' + currentlyWriting).set(data)
                .then(() => {
                //像素已成功保存，我们将等待像素侦听器拾取新像素，然后再将其绘制到画布上。
                currentlyWriting = null;
                startCoolDown();
                console.log('success!');
            })
                .catch(error => {
                    //这里的错误可能是由于生成时间戳和保存像素之间的互联网连接中断
                    //数据库有一个规则集来检查生成的时间戳和随像素发送的时间戳。
                    //这也可能是由于Firebase免费层的使用限制。
                console.error('could not write pixel');
            });
        })
            .catch(error => {
                //未能创建新的时间戳。可能是因为用户没有
                //等待他们的冷却期结束。
            console.error('you need to wait for cool down period to finish');
        });
    }
}
function startCoolDown() {
    // 取消选择颜色
    if (clearColorSelectionOnCoolDown)
        selectColor(null);
    //将.cooling类添加到主体
    //所以倒计时钟出现了
    body.classList.add('cooling');
    //启动以毫秒为单位的冷却时间超时，毫秒也在数据库规则中设置，因此删除此代码不允许用户跳过冷却
    setTimeout(() => endCoolDown(), coolDownTime);
    //coolCount用于写入倒计时时钟
    coolCount = coolDownTime;
    // 先更新倒计时时钟
    updateCoolCounter();
    // 开始一段时间间隔，每秒钟更新一次倒计时时钟
    clearInterval(coolInterval);
    /*clearInterval() 方法可取消由 setInterval() 设置的 timeout。
	clearInterval() 方法的参数必须是由 setInterval() 返回的 ID 值。*/
    coolInterval = setInterval(updateCoolCounter, 1000);
    /*setInterval() 方法可按照指定的周期（以毫秒计）来调用函数或计算表达式。
	setInterval() 方法会不停地调用函数，直到 clearInterval() 被调用或窗口被关闭。
	由 setInterval() 返回的 ID 值可用作 clearInterval() 方法的参数。*/
}
function updateCoolCounter() {
    // 从coolCount中剩余的毫秒数中计算出剩余的分和秒数
    let mins = String(Math.floor((coolCount / (1000 * 60)) % 60));
    let secs = String((coolCount / 1000) % 60);
    // 更新DOM中的冷却计数器
    coolDownText.innerHTML = mins + ':' + (secs.length < 2 ? '0' : '') + secs;
    // 删除1秒（1000毫秒），为下一次更新做好准备。
    coolCount -= 1000;
}
function endCoolDown() {
    // set coolCount to 0, just in case it went
    // over, intervals aren't perfect.
    //将coolCount设置为0，以防万一，间隔并不完美。
    coolCount = 0;
    // 停止更新间隔
    clearInterval(coolInterval);
    //从body中移除.cooling类，以便隐藏倒计时时钟。
    body.classList.remove('cooling');
}
function getTimestamp() {
    let promise = new Promise((resolve, reject) => {
        //用新的时间戳更新用户的“last_write”
        var ref = firebase.database().ref('last_write/' + uid);
        ref.set(firebase.database.ServerValue.TIMESTAMP)
            .then(() => {
                /*时间戳被保存了，但是因为数据库生成了它，所以我们不知道它是什么，所以我们必须请求它。*/
            ref.once('value')
                .then(timestamp => {
                    // 我们得到了一个新的时间戳
                resolve(timestamp.val());
            })
                .catch(reject);
        })
            .catch(reject);
    });
    return promise;
}
// 绘制像素函数
function startListeners() {
    console.log('Starting Firebase listeners');
    //获取对数据库中像素表的引用
    let placeRef = firebase.database().ref("pixel");
    //获取网格中所有值的一次更新，以便我们可以在第一次加载时绘制所有内容。

    // placeRef.once('value')
    // 	.then(snapshot => 
    // 	{
    // 		// draw all the pixels in the grid
    // 		var grid = snapshot.val();
    // 		for(let i in grid)
    // 		{
    // 			renderPixel(i, grid[i]);
    // 		}
    //开始侦听像素的更改
    placeRef.on('child_changed', onChange);
    //同样开始监听新的像素，网格位置，从来没有一个像素画在他们是新的。
    placeRef.on('child_added', onChange);
    // })
    // .catch(error => {
    // 	console.log(error);
    // })
    ready = true;
}
function onChange(change) {
    body.classList.remove('loading');
    //渲染新的像素关键点是网格位置
    // for example "34x764"
    // val will be a pixel object defined
    // by the Pixel interface at the top.
    renderPixel(change.key, change.val());
}
function setupStage() {
    // 用Pixi.js设置画布
    app = new PIXI.Application(window.innerWidth, window.innerHeight - 60, { antialias: false, backgroundColor: 0xeeeeee });
    canvasContainer.appendChild(app.view);
    //为网格创建一个容器，容器将用于缩放

    container = new PIXI.Container();
    // 把容器放到stage上
    app.stage.addChild(container);
    // 图形是我们画像素的画布，当用户拖动时也会移动它
    graphics = new PIXI.Graphics();
    graphics.beginFill(0xffffff, 1);
    graphics.drawRect(0, 0, gridSize[0] * squareSize[0], gridSize[1] * squareSize[1]);
    graphics.interactive = true;
    /*设置输入侦听器时，我们使用pointerdown、pointermove等，
    而不是mousedown、mousemove等，因为它在鼠标和触摸屏上都会触发*/
    graphics.on('pointerdown', onDown);
    graphics.on('pointermove', onMove);
    graphics.on('pointerup', onUp);
    graphics.on('pointerupoutside', onUp);
    //移动图形，使其中心位于x0 y0
    graphics.position.x = -graphics.width / 2;
    graphics.position.y = -graphics.height / 2;
    //将图形放入容器中
    container.addChild(graphics);
    gridLines = new PIXI.Graphics();
    gridLines.lineStyle(0.5, 0x888888, 1);
    gridLines.alpha = 0;
    gridLines.position.x = graphics.position.x;
    gridLines.position.y = graphics.position.y;
    for (let i = 0; i <= gridSize[0]; i++) {
        drawLine(0, i * squareSize[0], gridSize[0] * squareSize[0], i * squareSize[0]);
    }
    for (let j = 0; j <= gridSize[1]; j++) {
        drawLine(j * squareSize[1], 0, j * squareSize[1], gridSize[1] * squareSize[1]);
    }
    container.addChild(gridLines);
    //开始页调整侦听器的大小，这样我们就可以保持画布的正确大小
    window.onresize = onResize;
    //让画布填满屏幕。
    onResize();
    //添加缩放按钮控件
    zoomInButton.addEventListener("click", () => { toggleZoom({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, true); });
    zoomOutButton.addEventListener("click", () => { toggleZoom({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, false); });
}
function drawLine(x, y, x2, y2) {
    gridLines.moveTo(x, y);
    gridLines.lineTo(x2, y2);
}
function setupColorOptions() {
    //使用单击功能链接颜色选项。
    for (let i in colors) {
        //每个颜色按钮都有一个id=“c-”然后颜色值，例如“c-ffffff”是白色.
        let element = document.getElementById('c-' + colors[i]);
        //单击将颜色发送到selectColor函数
        element.addEventListener("click", (e) => { selectColor(colors[i]); });
        //将DOM元素添加到数组中，以便稍后再次使用
        colorOptions.push(element);
    }
}
function selectColor(color) {
    if (selectedColor !== color) {
        //如果新颜色与当前选定的颜色不匹配，则将其更改为新颜色

        selectedColor = color;
        //将.selectedColor类添加到body标记。
        //我们用它来更新信息框说明。
        body.classList.add('selectedColor');
    }
    else {
        //如果新颜色与当前选择的颜色匹配，则用户将关闭该颜色。

        selectedColor = null;
        //从body标记中删除.selectedColor类。
        body.classList.remove('selectedColor');
    }
    for (let i in colors) {
        //循环遍历中的所有颜色，如果颜色等于所选颜色，则将.active类添加到button元素
        if (colors[i] == selectedColor)
            colorOptions[i].classList.add('active');
        //否则删除.active类
        else
            colorOptions[i].classList.remove('active');
    }
}
function onResize(e) {
    //调整画布大小以填充屏幕
    app.renderer.resize(window.innerWidth, window.innerHeight);
    //将容器置于新窗口大小的中心。

    container.position.x = window.innerWidth / 2;
    container.position.y = window.innerHeight / 2;
}
function onDown(e) {
    //Pixi.js将其所有鼠标侦听器添加到窗口中，而不管它们被分配到画布中的哪个元素。
    //因此，为了避免在选择一种颜色时放大，我们首先检查点击是否没有在颜色选项所在的
    // 底部60像素处
    if (e.data.global.y < window.innerHeight - 60 && ready) {
        //我们保存鼠标向下的位置
        start = { x: e.data.global.x, y: e.data.global.y };
        //并设置一个标志，表示鼠标已放下

        mouseDown = true;
    }
}
function onMove(e) {
    //检查鼠标是否已按下（换句话说，检查用户是否已单击或触地但尚未抬起）
    if (mouseDown) {
        //如果还没检测到拖动
        if (!dragging) {
            //我们得到鼠标的当前位置
            let pos = e.data.global;
            //并检查新位置是否从第一个鼠标向下位置向任何方向移动了超过5个像素
            if (Math.abs(start.x - pos.x) > 5 || Math.abs(start.y - pos.y) > 5) {
                //如果有，我们可以假设用户正在尝试绘制视图而不是点击
                //我们将图形存储在当前位置，以便稍后用鼠标位置偏移其位置。
                graphicsStart = { x: graphics.position.x, y: graphics.position.y };
                //设置拖动标志
                dragging = true;
                //将.draging类添加到DOM中，这样我们就可以切换到移动光标
                body.classList.add('dragging');
            }
        }
        if (dragging) {
            //基于鼠标位置更新图形位置，偏移起始位置和图形原始位置
            //gridLines：网格线
            graphics.position.x = ((e.data.global.x - start.x) / scale) + graphicsStart.x;
            graphics.position.y = ((e.data.global.y - start.y) / scale) + graphicsStart.y;
            gridLines.position.x = ((e.data.global.x - start.x) / scale) + graphicsStart.x;
            gridLines.position.y = ((e.data.global.y - start.y) / scale) + graphicsStart.y;
        }
    }
}
function onUp(e) {
    //从DOM中清除.dragging类
    body.classList.remove('dragging');
    //如果鼠标向下超出界限（例如在底部60px），则忽略鼠标向上

    if (mouseDown && ready) {
        //清除鼠标向下标记
        mouseDown = false;
        //如果在所有鼠标移动期间从未设置拖动标志，则这是单击

        if (!dragging) {
            //如果选择了颜色并放大了视图，则单击此按钮将绘制一个新像素
            if (selectedColor && zoomed) {
                //获取新的鼠标位置
                let position = e.data.getLocalPosition(graphics);
                //把x和y四舍五入
                let x = Math.floor(position.x / squareSize[0]);
                let y = Math.floor(position.y / squareSize[1]);
                writePixel(x, y, selectedColor);
            }
            else {
                //如果某个颜色没有被选中，或者它已经被选中，但目前页面是缩放状态，
                // 无论哪种方式，单击此按钮都将切换缩放级别
                toggleZoom(e.data.global);
            }
        }
        dragging = false;
    }
}
function renderPixel(pos, pixel)        //像素渲染
{
    //将pos字符串在'x'处拆分，因此'100x200'将成为一个数组['100'，'200']
    let split = pos.split('x');
    //使用+将值赋给x和y变量，将字符串转换为数字

    let x = +split[0];
    let y = +split[1];
    //从像素对象中获取颜色

    let color = pixel.color;
    //在图形画布上绘制方块
    graphics.beginFill(parseInt('0x' + color), 1);
    graphics.drawRect(x * squareSize[0], y * squareSize[1], squareSize[0], squareSize[1]);
}
function toggleZoom(offset, forceZoom) {
    console.log(forceZoom);
    //切换缩放变量
    zoomed = forceZoom !== undefined ? forceZoom : !zoomed;
    //缩放将等于4，否则缩放将为1

    scale = zoomed ? zoomLevel : 1;
    //向body标签添加或删除.zoomed类。这样我们就可以更改信息框的说明
    if (zoomed)
        body.classList.add('zoomed');
    else
        body.classList.remove('zoomed');
    let opacity = zoomed ? 1 : 0;
    //使用GSAP在尺度之间进行动画。我们是在缩放容器，而不是图像。

    TweenMax.to(container.scale, 0.5, { x: scale, y: scale, ease: Power3.easeInOut });
    let x = offset.x - (window.innerWidth / 2);
    let y = offset.y - (window.innerHeight / 2);
    let newX = zoomed ? graphics.position.x - x : graphics.position.x + x;
    let newY = zoomed ? graphics.position.y - y : graphics.position.y + y;
    TweenMax.to(graphics.position, 0.5, { x: newX, y: newY, ease: Power3.easeInOut });
    TweenMax.to(gridLines.position, 0.5, { x: newX, y: newY, ease: Power3.easeInOut });
    TweenMax.to(gridLines, 0.5, { alpha: opacity, ease: Power3.easeInOut });
}
/*

Firebase database rules are set to...

{
  "rules": {
    "last_write": {
      "$user": {
        ".read": "auth.uid === $user",
        ".write": "newData.exists() && auth.uid === $user",
        ".validate": "newData.isNumber() && newData.val() === now && (!data.exists() || newData.val() > data.val()+10000)"
      }
    },
    "pixel": {
      ".read": "true",
      "$square": {
            ".write": "auth !== null",
            ".validate": "newData.hasChildren(['uid', 'color', 'timestamp']) && $square.matches(/^([0-9]|[1-9][0-9]|[1-9][0-9][0-9])x([0-9]|[1-9][0-9]|[1-9][0-9][0-9])$/)",
            "uid": {
            ".validate": "newData.val() === auth.uid"
          },
          "timestamp": {
            ".validate": "newData.val() >= now - 500 && newData.val() === data.parent().parent().parent().child('last_write/'+auth.uid).val()"
          },
          "color": {
            ".validate": "newData.isString() && newData.val().length === 6 && newData.val().matches(/^(ffffff|e4e4e4|888888|222222|ffa7d1|e50000|e59500|a06a42|e5d900|94e044|02be01|00d3dd|0083c7|0000ea|cf6ee4|820080)$/)"
          }
      }
    }
  }
}

*/
// the rules to prevent adding pixels during cooldown
// were written with help from http://stackoverflow.com/a/24841859