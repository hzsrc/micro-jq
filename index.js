/*
 事件管理和DOM操作
 */
var $;//实现全局唯一,暂时用这个恶心的方式
if (!$) $ = (function () {
    "use strict";
    /*cache结构为：
     {元素键值1:{click:[callback1,callback2],touchend:[{fn:fn}]}
     ,元素键值2:{click:[{fn:fn1},{fn:fn2}...]}
     ...}
     */
    var cache = {};
    var tap = 'mytap', //避免与zepto的tap冲突,待不用zepto时可以去除
        tapDelay = 300, tapMaxMove = 15; //能触发tap的最大时间间隔和最大位移
    /**
     * 生成Query包装对象
     * @param q 可为选择器、html字符串、DOM元素、Query对象、函数。
     *          为选择器时,调用querySelectorAll方法获取元素
     *          为html字符串时(根据首字符是否为"<"判断),会生成内存DOM节点元素,并以所有根节点包装作为返回值
     *          为DOM元素时,直接包装
     *          为Query对象时,直接返回本身
     *          为函数时,等同于domready
     * @param c 选择器的上下文DOM元素
     */
    var $ = function (q, c) {
        if (typeof q == 'function')
            ready(q);
        else if (q instanceof Query)
            return q;
        else
            return new Query(q, c);
    };

    /*
     DomReady实现
     */
    function ready(callback) {
        if (/complete|loaded|interactive/.test(document.readyState))
            callback()
        else
            document.addEventListener('DOMContentLoaded', onload, false);

        function onload() {
            document.removeEventListener('DOMContentLoaded', onload);
            callback()
        }
    }

    /**
     * 读取缓存，将元素和事件关联起来
     * @param el DOM元素
     * @param evt 事件名称
     * @returns {Array} 事件handler列表
     */
    function data(el, evt) {
        var key = getKey(el);
        var elEvts = cache[key] || (cache[key] = {});
        return elEvts[evt] || (elEvts[evt] = []);

        function getKey(el) {
            if (el.getAttribute) {
                var key = el.getAttribute('__qkey');
                if (!key) {
                    el.setAttribute('__qkey', key = Math.random());
                }
            } else {
                var key = el.__qkey;
                if (!key) {
                    el.__qkey = key = Math.random();
                }
            }
            return key;
        }
    }

    /**
     * 遍历对象属性或数组
     * @param o Object类型或Array类型
     * @param fn 回调函数.
     *           对于Array,fn形式为function(arrItem){}
     *           对于Object,fn形式为function(propertyKey, propertyValue){}
     */
    $.each = function (o, fn) {
        if (o instanceof Array)
            o.forEach(fn);
        else
            for (var k in o)
                fn(k, o[k])
    }
    /*
     清除非永久性的事件绑定
     通过$(selector).on方法第3个参数,来指定是否为永久性事件绑定
     */
    $.clear = function () {
        $.each(cache, function (key, elEvts) {
            $.each(elEvts, function (evt, cbs) {
                cbs.forEach(function (cb, i) {
                    //移除非永久的回调
                    if (!cb.forEver) cbs.splice(i, 1)
                });
                if (cbs.length == 0) delete elEvts[evt]
            })
            if (Object.keys(elEvts).length == 0)delete cache[key]
        })
    };
    $.event = {
        on: function (qObj, evts, fn, forEver, once) {
            if (once) once = function () {
                $.event.off(qObj, evts, fn)
            }
            tryEach(qObj, function (e) {
                evts.split(',').forEach(function (evt) {
                    evt == 'tap' && (evt = tap);
                    var cb = {fn: fn, forEver: !!forEver, _fn: once};
                    var l = data(e, evt);
                    //只需绑一次事件
                    if (l.length == 0 && e.addEventListener) e.addEventListener(evt, $.event.dispatch, false);
                    l.push(cb);
                })
            })
        },
        off: function (qObj, evts, fn) {
            tryEach(qObj, function (e) {
                evts.split(',').forEach(function (evt) {
                    evt == 'tap' && (evt = tap);
                    var cbs = data(e, evt);
                    if (fn === undefined) {
                        cbs.splice(0, cbs.length);//clear
                    }
                    else {
                        for (var i = 0; i < cbs.length; i++) {
                            //是同一个函数,或者函数的globalId相同,即可移除
                            if (cbs[i].fn == fn || (fn.globalId && fn.globalId == cbs[i].fn.globalId)) {
                                cbs.splice(i, 1);//remove one
                                i--;
                            }
                        }
                    }
                    if (cbs.length == 0) {
                        e.removeEventListener && e.removeEventListener(evt, $.event.dispatch);
                    }
                });
            });
        },
        /**
         * 所有绑定事件的统一代理方法
         */
        dispatch: function (evt) {
            var cbs = data(this, evt.type).slice(0)//复制,避免还没轮执行到就被移除
                , el = this, args = [evt];
            evt.args && args.push.apply(args, evt.args);
            cbs.forEach(function (cb) {
                cb.fn && cb.fn.apply(el, args);
                //为实现one()的内部处理
                cb._fn && cb._fn();
            })
        },
        /*
         构建自定义事件
         */
        create: function (evt, noBubble) {
            evt == 'tap' && (evt = tap);
            var eType = //"click,mousedown,mouseup,mousemove".indexOf(evt) > -1 ? "MouseEvents" :
                "Events";
            var event = document.createEvent(eType);
            event.initEvent(evt, !noBubble, true);
            return event
        }
    };

    /**
     * 包装对象
     * @param selector 选择器
     *                 如果以“<”开头，作为html构建内存节点；
     *                 否则作为选择器，querySelectorAll的参数
     * @param context 选择器的上下文对象
     */
    function Query(selector, context) {
        this.es = [], this.length = 0;
        var es = typeof selector == 'string'
            ? (selector.substr(0, 1) == '<' ? buildByFragment(selector) : select(selector, context))
            : (selector ? [selector] : []);
        setItems(this, es)
    }

    /*以元素数组来构建Query对象*/
    function arrQuery(es) {
        var r = $();
        setItems(r, es);
        return r;
    }

    /**
     * 选择器
     */
    function select(selector, context) {
        context = context || document;
        return context.querySelectorAll(selector);
    }

    /*
     * 传入html，构建为内存对象
     */
    function buildByFragment(html) {
        var div = document.createElement('div');
        div.innerHTML = html;
        var nodes = toArr(div.children);
        div.innerHTML = '';
        return nodes;
    }

    //下面这些方法含义和jQuery类似
    Query.prototype = $.fn = {
        /**
         * 绑定事件.forEver的事件不会被clear,但可以解绑
         */
        on: function (evt, fn, forEver, once) {
            $.event.on(this, evt, fn, forEver, once);
            return this
        },
        /**
         * 解绑事件
         * @param fn 解绑的函数.
         *           如果不指定,则移除此事件上绑定的所有函数
         *           需和绑定时的函数是同一个函数实例才能解绑（注意:闭包中声明的函数,每次执行时不是同一个实例）.
         *           如果希望强制解除,可以为fn指定一个固定的globalId属性(不同的函数实例只要globalId相同,就能互相解绑)
         */
        off: function (evt, fn) {
            $.event.off(this, evt, fn);
            return this
        },
        /**
         * 绑定事件,执行一次后自动解绑
         */
        one: function (evt, fn, forEver) {
            return this.on(evt, fn, forEver, 1);
        },
        /*
         先解绑,再绑定. 可避免重复绑定,参数与off和on方法一致
         */
        offOn: function (evt, fn, forEver, once) {
            return this.off(evt, fn).on(evt, fn, forEver, once)
        },
        find: function (selector) {
            return eachJoin(this, function (e) {
                return select(selector, e)
            });
        },
        eq: function (i) {
            return $(this[i]);
        },
        slice: function (start, end) {
            return arrQuery(this.es.slice(start, end));
        },
        //其他方法
        first: function () {
            return this.eq(0);
        },
        last: function () {
            return this.eq(this.length - 1);
        },
        parent: function () {
            return eachJoin(this, function (e) {
                return e.parentNode
            });
        },
        closest: function (selector) {
            return eachJoin(this, function (e) {
                do {
                    e = e.parentNode;
                } while (e && !elIs(e, selector));
                return e;
            });
        },
        next: function () {
            return eachJoin(this, function (e) {
                return sibling(e, 1)
            })
        },
        prev: function () {
            return eachJoin(this, function (e) {
                return sibling(e)
            })
        },
        children: function () {
            return eachJoin(this, function (e) {
                return e.children
            })
        },
        remove: function () {
            return tryEach(this, function (e) {
                e.parentNode.removeChild(e);
            })
        },
        /*css: function (p, val) {
         return typeof p == 'string'
         ? tryEach(this, function (e) {
         e.style[p] = val;
         })
         : tryEach(this, function (e) {
         for (var n in p)
         e.style[n] = p[n];
         })
         },*/
        addClass: function (cls) {
            return tryEach(this, function (e) {
                cls && cls.split(' ').forEach(function (i) {
                    e.classList.add(i)
                })
            })
        },
        /*
         @param cls 要移除的class,如果不传此参数,则移除所有class
         */
        removeClass: function (cls) {
            var removeAll = !arguments.length;
            return tryEach(this, function (e) {
                removeAll ? e.className = '' : e.classList.remove(cls);
            })
        },
        toggleClass: function (cls, isAdd) {
            var noArg2 = arguments.length == 1;
            return tryEach(this, function (e) {
                if (noArg2)
                    isAdd = !e.classList.contains(cls);
                e.classList[isAdd ? 'add' : 'remove'](cls);
            })
        },
        hasClass: function (cls) {
            var e = this.es[0];
            return e && e.classList.contains(cls)
        },
        css: function (n, val) {
            var isString = typeof n == 'string', arg = arguments;
            return access(this, arg, 1, function (e) {
                return e.style[n];
            }, function (e) {
                if (isString) {
                    e.style[n] = val;
                } else {
                    for (var k in n) {
                        e.style[k] = n[k];
                    }
                }
            }, function () {
                return isString && arg.length < 2;
            });
        },
        hide: function () {
            return tryEach(this, function (e) {
                e.style.display = 'none';
            })
        },
        show: function () {
            return tryEach(this, function (e) {
                e.style.display = 'initial';
            })
        },
        text: function (tx) {
            return access(this, arguments, 0, function (e) {
                return e.tagName == 'SELECT' ? (e = e.options[e.selectedIndex]) && e.text : e.textContent
            }, function (e) {
                e.textContent = tx
            });
        },
        html: function (htm) {
            return access(this, arguments, 0
                , function (e) {
                    return e.innerHTML
                }
                , function (e) {
                    e.innerHTML = htm || '';
                }
            );
        },
        val: function (v) {
            return access(this, arguments, 0, function (e) {
                return e.value
            }, function (e) {
                e.value = v === undefined ? '' : v;
            });
        },
        is: function (selector) {
            return elIs(this.es[0], selector);
        },
        rect: function () {
            return getRect(this.es[0]);
        },
        /**
         * 取style.width或offsetWidth
         */
        width: function (val) {
            return access(this, arguments, 0
                , function (e) {
                    return getRect(e).width
                }
                , function (e) {
                    if (/^[\d\.]+$/.test(val)) {
                        val += 'px'
                    }
                    e.style.width = val
                }
            );
        },
        /**
         * 取style.height或offsetHeight
         */
        height: function (val) {
            return access(this, arguments, 0
                , function (e) {
                    return getRect(e, 1).height
                }
                , function (e) {
                    if (/^[\d\.]+$/.test(val)) {
                        val += 'px';
                    }
                    e.style.height = val
                }
            );
        },
        /*
         获取或设置属性.如果是元素固有属性,直接操作之;否则通过setAttribute设置
         */
        attr: function (name, val) {
            return access(this, arguments, 1
                , function (e) {
                    return isElProperty(e, name) ? e[name] : e.getAttribute(name)
                }
                , function (e) {
                    if (isElProperty(e, name)) e[name] = val;
                    else e.setAttribute(name, val);
                }
            );
            //判断是否是元素固有属性,如disabled或checked
            function isElProperty(e, name) {
                while (e != null) {
                    if (e.hasOwnProperty(name)) return true;
                    e = e.__proto__;
                }
                return false
            }
        },
        /*
         * 节点操作
         */
        /*prepend: function (es) {
         return tryEach2(this, es, function (prt, child) {
         prt.insertBefore(child, prt.childNodes[0])
         })
         },
         prependTo: function (es) {
         return tryEach2(this, es, function (child, prt) {
         prt.insertBefore(child, prt.childNodes[0])
         })
         },*/
        append: function (es) {
            return tryEach2(this, es, function (prt, child) {
                prt.appendChild(child)
            })
        },
        appendTo: function (es) {
            return tryEach2(this, es, function (child, prt) {
                prt.appendChild(child)
            })
        },
        before: function (es) {
            return tryEach2(this, es, function (e1, e2) {
                e2.parentNode.insertBefore(e1, e2)
            })
        },
        //在DOM节点上触发事件,支持冒泡
        trigger: function (name, noBubble) {
            var event = typeof name === 'string' ? $.event.create(name, noBubble) : name;
            event.args = [].slice.call(arguments, 2);
            return tryEach(this, function (e) {
                e.dispatchEvent ? e.dispatchEvent(event) : $.event.dispatch.call(e, event);
            })
        },
        //触发元素上绑定的事件操作
        triggerHandler: function (name) {
            var event = $.event.create(name);
            return tryEach(this, function (e) {
                $.event.dispatch.call(e, event)
            })
        },
        each: function (fn) {
            this.es.forEach(fn);
        }
    };
    //一系列的事件方法，on方法的简写。移动端省略了鼠标事件
    ["blur", "focus", "focusin", "focusout", "load", "resize", "scroll", "unload"
        , tap//, "click", "dblclick", "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave"
        , "touchmove", "touchstart", "touchend", "touchcancel"
        , "change", "select", "submit", "keydown", "input", "keypress", "keyup", "error"//, "contextmenu"
    ].forEach(function (evt) {
        $.fn[evt] = function (fn, forEver, once) {
            return this.on(evt, fn, forEver, once)
        }
    });
    $.fn.tap = $.fn[tap];

    /*
     判断元素e是否符合选择器
     */
    function elIs(e, selector) {
        var m = e && (e.webkitMatchesSelector || e.matchesSelector || e.matches);
        return m ? m.call(e, selector) : $(selector).es.indexOf(e) > -1;
    }

    /**
     * 根据val是否传递，来获取值，或者设置值
     */
    function access(qObj, args, i, fnGet, fnSet, fnJudge) {
        //没有索引为i的参数,就作为fnGet
        if (fnJudge ? fnJudge() : args.length <= i) {
            var r = qObj[0] && fnGet(qObj[0]);
            return r === undefined || r === null ? '' : r;
        }
        else if (fnSet) {
            qObj.es.forEach(function (e) {
                fnSet(e, args[i])
            });
            return qObj;
        }
    }

    /**
     * 尝试遍历内部数组
     */
    function tryEach(qObj, fn) {
        try {
            qObj.es.forEach(fn)
        } catch (e) {
        }
        return qObj;
    }

    function tryEach2(qObj, el, fn) {
        qObj.es.forEach(function (e) {
            try {
                $(el).es.forEach(function (e2) {
                    fn.call(e, e, e2)
                })
            } catch (ex) {
            }
        });
        return qObj;
    }

    /**
     * 根据结果扩充或缩减内部数组
     */
    function eachJoin(qObj, fn) {
        try {
            var es = [];
            qObj.es.forEach(function (e) {
                var r = fn(e);
                if (r && r.length !== undefined && !r.tagName) {
                    r = r instanceof Array ? r : toArr(r);
                    es = es.concat(r);
                }
                else if (r && es.indexOf(r) == -1) {
                    es.push(r);
                }
            });
        } catch (e) {
        }
        return arrQuery(es);
    }

    /**
     * 获取非文本兄弟节点
     */
    function sibling(e, next) {
        try {
            do {
                e = (next ? e.nextSibling : e.previousSibling)
            } while (e && e.nodeType != 1);
        } catch (e) {
        }
        return e
    }

    /*
     获取高度或宽度,位置
     */
    function getRect(el, isHeight) {
        var name = isHeight ? 'Height' : 'Width';
        if (el === window) {
            var w = window;
            return {
                height: w['inner' + name],
                width: w['inner' + name],
                left: w.pageXOffset,
                top: w.pageYOffset
            }
        }
        return el && el.getBoundingClientRect();
    }

    /*
     将集合转换为数组
     */
    function toArr(coll) {
        return [].slice.call(coll, 0)
    }

    /**
     * 根据新对象数组，设置索引属性值和length值
     */
    function setItems(qObj, es) {
        var i;
        for (i = 0; i < qObj.length; i++) {
            delete qObj[i]
        }
        if (!(es instanceof Array)) {
            es = toArr(es);
        }
        for (i = 0; i < es.length; i++) {
            qObj[i] = es[i];
        }
        qObj.es = es;
        qObj.length = es.length
    }

    /*
     模拟tap事件,模拟stroke事件
     tap事件:点击屏幕,不移动,并立即抬起时触发
     支持changedTouches等属性
     支持preventDefault().(事件绑在body上,故stopPropagation无意义)
     简化处理:如果touchstart和touchend移动范围很小,而且时间间隔短,则触发tap事件

     stroke事件: 点击屏幕,拖动,然后抬起时触发
     支持deltaX和deltaY属性,表示移动的距离.值的正负表示方向.
     支持preventDefault()
     */
    $(function () {
        var time, x, y, el;
        $(document.body).touchstart(function (e) {
            time = Date.now();
            el = e.target;
            x = e.changedTouches[0].pageX;
            y = e.changedTouches[0].pageY;

            $(e.target).addClass('tapping');
            setTimeout(function () {
                $(e.target).removeClass('tapping');
            }, tapDelay);
        }, 1).touchend(function (e) {
            if (el == e.target) {
                var tch = e.changedTouches[0], timespan = Date.now() - time
                    , dx = tch.pageX - x, dy = tch.pageY - y
                    , dt = Math.abs(dx) + Math.abs(dy);
                if (dt < tapMaxMove) {
                    if (timespan < tapDelay) {
                        fire(tap, e, {})
                    }
                } else if (dt > tapMaxMove * 3) {
                    var attr = {deltaX: dx, deltaY: dy};
                    fire('stroke', e, attr);
                }
            }
        }, 1);
        /*
         基于TouchEvent触发touch类模拟事件
         */
        function fire(evt, e, attr) {
            var tapE = document.createEvent('Event');
            tapE.initEvent(evt, true, true);
            ['touches', 'targetTouches', 'changedTouches'].forEach(function (a) {
                tapE[a] = e[a];
            });
            Object.keys(attr).forEach(function (a) {
                tapE[a] = attr[a]
            });
            $(e.target).trigger(tapE);//在DOM上触发事件绑定（同步执行）
            if (tapE.defaultPrevented) e.preventDefault();
        }
    });

    return $;
})();

module.exports = $;
