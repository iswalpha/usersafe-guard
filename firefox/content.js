// 内容脚本 - 在页面中运行，检测脚本
(function() {
    'use strict';

    // Firefox 兼容性
    const isFirefox = typeof browser !== 'undefined';
    const runtime = isFirefox ? browser : chrome;

    let analyzedScripts = new Set();
    let blockedScripts = new Set();
    let isInitialized = false;

    // 消息监听器
    runtime.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        try {
            if (request.action === "scanScripts") {
                const scripts = scanAllScripts();
                sendResponse({scripts: scripts});
            } else if (request.action === "autoScanAndSend") {
                autoScanAndSend().then(() => {
                    sendResponse({success: true});
                }).catch(error => {
                    sendResponse({success: false, error: error.message});
                });
                return true; // 保持消息通道开放
            } else if (request.action === "analysisResult") {
                handleAnalysisResult(request.data);
                sendResponse({success: true});
            } else if (request.action === "ping") {
                sendResponse({status: "ready", initialized: isInitialized});
            } else if (request.action === "getBlockedScripts") {
                sendResponse({blockedScripts: Array.from(blockedScripts)});
            } else {
                sendResponse({success: false, error: 'Unknown action'});
            }
        } catch (error) {
            sendResponse({success: false, error: error.message});
        }
        
        return true; // 对于异步操作返回 true
    });

    // 扫描所有脚本
    function scanAllScripts() {
        const scripts = [];
        const currentDomain = window.location.hostname.replace(/^www\./, '');
        
        // 获取所有script标签
        const scriptElements = document.querySelectorAll('script[src]');
        
        scriptElements.forEach(script => {
            const src = script.src;
            let type = 'external';
            
            try {
                const scriptDomain = new URL(src).hostname.replace(/^www\./, '');
                if (scriptDomain === currentDomain) {
                    type = 'internal';
                }
            } catch (e) {
                // 如果URL解析失败，视为外部脚本
                type = 'external';
            }
            
            scripts.push({
                src: src,
                type: type,
                element: script.outerHTML.substring(0, 100), // 保存部分HTML用于识别
                status: script.hasAttribute('data-blocked') ? 'blocked' : 'loaded'
            });
        });
        
        return scripts;
    }

    // 自动扫描并发送到服务
    async function autoScanAndSend() {
        const scripts = scanAllScripts();
        const externalScripts = scripts.filter(script => script.type === 'external');
        
        if (externalScripts.length === 0) {
            return;
        }

        // 过滤掉已经分析过的脚本
        const newScripts = externalScripts.filter(script => !analyzedScripts.has(script.src));
        
        if (newScripts.length === 0) {
            return;
        }

        // 添加到已分析集合
        newScripts.forEach(script => analyzedScripts.add(script.src));

        const payload = {
            pageUrl: window.location.href,
            pageTitle: document.title,
            timestamp: new Date().toISOString(),
            scripts: newScripts.map(script => ({
                url: script.src,
                domain: extractDomain(script.src),
                type: 'external',
                element: script.element
            }))
        };

        try {
            // 发送到background script进行处理
            const response = await runtime.runtime.sendMessage({
                action: "sendScriptsToService",
                data: payload
            });
            
            if (response && response.success) {
                // 成功发送，静默处理
            }
        } catch (error) {
            // 连接失败，静默处理
        }
    }

    function extractDomain(url) {
        try {
            const domain = new URL(url).hostname;
            return domain.replace(/^www\./, '');
        } catch (e) {
            return url;
        }
    }

    // 处理分析结果
    function handleAnalysisResult(analysisData) {
        if (analysisData.results && analysisData.results.length > 0) {
            // 在页面上显示分析结果（可选）
            showAnalysisNotification(analysisData);
            
            // 对于高风险脚本，可以采取进一步操作
            handleHighRiskScripts(analysisData.results);
            
            // 发送分析结果到popup
            sendAnalysisResultToPopup(analysisData);
        }
    }

    // 发送分析结果到popup
    function sendAnalysisResultToPopup(analysisData) {
        runtime.runtime.sendMessage({
            action: "analysisResult",
            data: analysisData
        }).catch(() => {
            // Popup未打开，静默失败
        });
    }

    // 在页面上显示分析通知
    function showAnalysisNotification(analysisData) {
        const highRiskCount = analysisData.results.filter(r => r.riskLevel === 'high').length;
        const mediumRiskCount = analysisData.results.filter(r => r.riskLevel === 'medium').length;
        const blockedCount = analysisData.results.filter(r => r.blocked).length;
        
        if (blockedCount > 0) {
            createNotification(`已阻止 ${blockedCount} 个高风险脚本执行`, 'warning');
        } else if (highRiskCount > 0) {
            createNotification(`发现 ${highRiskCount} 个高风险脚本，${mediumRiskCount} 个中风险脚本`, 'warning');
        } else if (mediumRiskCount > 0) {
            createNotification(`发现 ${mediumRiskCount} 个中风险脚本`, 'info');
        } else {
            createNotification(`已分析 ${analysisData.results.length} 个外部脚本，均为低风险`, 'success');
        }
    }

    // 创建页面通知
    function createNotification(message, type) {
        // 移除现有通知
        const existingNotifications = document.querySelectorAll('.script-detector-notification');
        existingNotifications.forEach(notification => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        });

        const notification = document.createElement('div');
        notification.className = 'script-detector-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${getNotificationColor(type)};
            color: white;
            border-radius: 8px;
            z-index: 10000;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-width: 350px;
            word-wrap: break-word;
            border-left: 4px solid ${getNotificationBorderColor(type)};
            animation: scriptDetectorSlideIn 0.3s ease-out;
        `;
        
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        
        const iconSpan = document.createElement('span');
        iconSpan.style.fontSize = '16px';
        iconSpan.style.marginRight = '8px';
        iconSpan.textContent = getNotificationIcon(type);
        
        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        
        container.appendChild(iconSpan);
        container.appendChild(textSpan);
        notification.appendChild(container);
        
        document.body.appendChild(notification);
        
        // 添加CSS动画
        if (!document.querySelector('#script-detector-styles')) {
            const style = document.createElement('style');
            style.id = 'script-detector-styles';
            style.textContent = `
                @keyframes scriptDetectorSlideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes scriptDetectorSlideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        // 8秒后自动消失
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'scriptDetectorSlideOut 0.3s ease-in';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 8000);
        
        // 点击关闭
        notification.addEventListener('click', () => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        });
    }

    function getNotificationColor(type) {
        switch(type) {
            case 'success': return '#4caf50';
            case 'warning': return '#ff9800';
            case 'error': return '#f44336';
            case 'info': 
            default: return '#2196f3';
        }
    }

    function getNotificationBorderColor(type) {
        switch(type) {
            case 'success': return '#388e3c';
            case 'warning': return '#f57c00';
            case 'error': return '#d32f2f';
            case 'info': 
            default: return '#1976d2';
        }
    }

    function getNotificationIcon(type) {
        switch(type) {
            case 'success': return '✅';
            case 'warning': return '⚠️';
            case 'error': return '❌';
            case 'info': 
            default: return 'ℹ️';
        }
    }

    // 处理高风险脚本 - 阻止执行
    function handleHighRiskScripts(results) {
        const highRiskScripts = results.filter(r => r.riskLevel === 'high');
        
        if (highRiskScripts.length > 0) {
            highRiskScripts.forEach(script => {
                // 阻止脚本执行
                const blocked = blockScriptExecution(script.url);
                if (blocked) {
                    script.blocked = true;
                    blockedScripts.add(script.url);
                    
                    // 记录阻止事件
                    logBlockedScript(script);
                }
            });
            
            // 更新页面显示被阻止的脚本
            updateBlockedScriptsDisplay();
        }
    }

    // 阻止脚本执行
    function blockScriptExecution(scriptUrl) {
        try {
            // 方法1: 移除已存在的script标签
            const existingScripts = document.querySelectorAll(`script[src="${scriptUrl}"]`);
            let blockedCount = 0;
            
            existingScripts.forEach(script => {
                if (!script.hasAttribute('data-blocked')) {
                    script.setAttribute('data-blocked', 'true');
                    script.setAttribute('data-original-src', script.src);
                    script.src = ''; // 清空src
                    script.type = 'text/blocked'; // 修改类型使其不执行
                    blockedCount++;
                }
            });
            
            // 方法2: 拦截动态创建的script标签
            interceptDynamicScripts(scriptUrl);
            
            // 方法3: 在Firefox中使用更安全的方法拦截请求
            if (isFirefox) {
                interceptScriptRequestsFirefox(scriptUrl);
            } else {
                interceptScriptRequestsChrome(scriptUrl);
            }
            
            return blockedCount > 0;
        } catch (error) {
            return false;
        }
    }

    // 拦截动态创建的script标签
    function interceptDynamicScripts(scriptUrl) {
        // 保存原始方法
        const originalCreateElement = document.createElement;
        
        // 重写createElement方法
        document.createElement = function(tagName) {
            const element = originalCreateElement.call(this, tagName);
            
            if (tagName.toLowerCase() === 'script') {
                // 拦截script元素的src属性设置
                const originalSetAttribute = element.setAttribute;
                element.setAttribute = function(name, value) {
                    if (name === 'src' && value === scriptUrl) {
                        value = ''; // 清空src
                    }
                    return originalSetAttribute.call(this, name, value);
                };
                
                // 拦截src属性直接赋值
                Object.defineProperty(element, 'src', {
                    get: function() {
                        return this.getAttribute('src');
                    },
                    set: function(value) {
                        if (value === scriptUrl) {
                            value = '';
                        }
                        this.setAttribute('src', value);
                    }
                });
            }
            
            return element;
        };
        
        // 恢复原始方法（避免重复重写）
        setTimeout(() => {
            document.createElement = originalCreateElement;
        }, 1000);
    }

    // Firefox 专用的脚本请求拦截方法
    function interceptScriptRequestsFirefox(scriptUrl) {
        // 在 Firefox 中，我们使用更安全的方法：
        // 1. 使用 MutationObserver 监控新添加的脚本
        // 2. 定期检查并阻止
        
        // 增强的 MutationObserver 来捕获动态加载的脚本
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    // 检查直接添加的 script 标签
                    if (node.nodeName === 'SCRIPT' && node.src && node.src.includes(scriptUrl)) {
                        if (!node.hasAttribute('data-blocked')) {
                            node.setAttribute('data-blocked', 'true');
                            node.src = '';
                            node.type = 'text/blocked';
                        }
                    }
                    
                    // 检查子节点中的 script 标签
                    if (node.querySelectorAll) {
                        const scripts = node.querySelectorAll('script[src]');
                        scripts.forEach(script => {
                            if (script.src.includes(scriptUrl) && !script.hasAttribute('data-blocked')) {
                                script.setAttribute('data-blocked', 'true');
                                script.src = '';
                                script.type = 'text/blocked';
                            }
                        });
                    }
                });
            });
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        
        // 定期检查新添加的脚本（作为备用方案）
        const checkInterval = setInterval(() => {
            const scripts = document.querySelectorAll(`script[src*="${scriptUrl}"]:not([data-blocked])`);
            scripts.forEach(script => {
                script.setAttribute('data-blocked', 'true');
                script.src = '';
                script.type = 'text/blocked';
            });
        }, 1000);
        
        // 10秒后停止定期检查（避免性能影响）
        setTimeout(() => {
            clearInterval(checkInterval);
        }, 10000);
    }

    // Chrome 专用的脚本请求拦截方法
    function interceptScriptRequestsChrome(scriptUrl) {
        try {
            // 拦截fetch请求
            const originalFetch = window.fetch;
            if (typeof originalFetch === 'function') {
                window.fetch = function(...args) {
                    const url = args[0];
                    if (typeof url === 'string' && url.includes(scriptUrl)) {
                        return Promise.reject(new Error('Script blocked by security extension'));
                    }
                    return originalFetch.apply(this, args);
                };
            }
            
            // 拦截XMLHttpRequest
            const originalXHROpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                if (typeof url === 'string' && url.includes(scriptUrl)) {
                    this._blocked = true;
                    return;
                }
                return originalXHROpen.call(this, method, url, ...rest);
            };
            
            const originalXHRSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function(...args) {
                if (this._blocked) {
                    this.dispatchEvent(new Event('error'));
                    return;
                }
                return originalXHRSend.call(this, ...args);
            };
        } catch (error) {
            // 拦截失败，静默处理
        }
    }

    // 记录被阻止的脚本
    function logBlockedScript(script) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            url: script.url,
            reason: script.reason || '高风险脚本',
            pageUrl: window.location.href,
            pageTitle: document.title
        };
        
        // 发送阻止记录到background
        runtime.runtime.sendMessage({
            action: "scriptBlocked",
            data: logEntry
        }).catch(() => {
            // 发送失败，静默处理
        });
    }

    // 更新页面显示被阻止的脚本
    function updateBlockedScriptsDisplay() {
        // 创建或更新阻止脚本列表显示
        let blockedList = document.getElementById('script-detector-blocked-list');
        if (!blockedList) {
            blockedList = document.createElement('div');
            blockedList.id = 'script-detector-blocked-list';
            blockedList.style.cssText = `
                position: fixed;
                bottom: 10px;
                right: 10px;
                background: #ffebee;
                border: 2px solid #f44336;
                border-radius: 8px;
                padding: 10px;
                max-width: 300px;
                max-height: 200px;
                overflow-y: auto;
                z-index: 9999;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                font-size: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            `;
            document.body.appendChild(blockedList);
        }
        
        if (blockedScripts.size > 0) {
            blockedList.textContent = '';
            
            const title = document.createElement('div');
            title.style.fontWeight = 'bold';
            title.style.color = '#d32f2f';
            title.style.marginBottom = '8px';
            title.textContent = `⚠️ 已阻止 ${blockedScripts.size} 个高风险脚本`;
            
            const content = document.createElement('div');
            content.style.color = '#666';
            content.style.fontSize = '11px';
            
            Array.from(blockedScripts).forEach(url => {
                const domainItem = document.createElement('div');
                domainItem.textContent = `• ${extractDomain(url)}`;
                content.appendChild(domainItem);
            });
            
            blockedList.appendChild(title);
            blockedList.appendChild(content);
            blockedList.style.display = 'block';
        } else {
            blockedList.style.display = 'none';
        }
    }

    // 监听动态添加的脚本
    function observeDynamicScripts() {
        const observer = new MutationObserver(function(mutations) {
            let shouldScan = false;
            let foundBlockedScripts = false;
            
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeName === 'SCRIPT' && node.src) {
                        // 检查是否是被阻止的脚本
                        const isBlocked = Array.from(blockedScripts).some(blockedUrl => 
                            node.src.includes(blockedUrl)
                        );
                        
                        if (isBlocked && !node.hasAttribute('data-blocked')) {
                            node.setAttribute('data-blocked', 'true');
                            node.src = '';
                            node.type = 'text/blocked';
                            foundBlockedScripts = true;
                        }
                        
                        shouldScan = true;
                    }
                    
                    // 检查子节点中的script标签
                    if (node.querySelectorAll) {
                        const childScripts = node.querySelectorAll('script[src]');
                        childScripts.forEach(script => {
                            const isBlocked = Array.from(blockedScripts).some(blockedUrl => 
                                script.src.includes(blockedUrl)
                            );
                            
                            if (isBlocked && !script.hasAttribute('data-blocked')) {
                                script.setAttribute('data-blocked', 'true');
                                script.src = '';
                                script.type = 'text/blocked';
                                foundBlockedScripts = true;
                            }
                        });
                        if (childScripts.length > 0) {
                            shouldScan = true;
                        }
                    }
                });
            });
            
            if (foundBlockedScripts) {
                updateBlockedScriptsDisplay();
            }
            
            if (shouldScan) {
                setTimeout(autoScanAndSend, 500);
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    // 初始化函数
    function initialize() {
        if (isInitialized) {
            return;
        }
        
        // 初始扫描
        setTimeout(() => {
            autoScanAndSend().catch(() => {
                // 初始扫描失败，静默处理
            });
        }, 2000);
        
        // 开始监听动态脚本
        observeDynamicScripts();
        
        // 发送就绪信号到background
        runtime.runtime.sendMessage({action: "contentScriptReady"})
            .catch(() => {
                // Background未就绪，静默处理
            });
        
        isInitialized = true;
    }

    // 根据页面状态初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // 导出函数供调试使用
    window.scriptDetector = {
        scanScripts: scanAllScripts,
        forceScan: autoScanAndSend,
        getAnalyzedScripts: () => Array.from(analyzedScripts),
        getBlockedScripts: () => Array.from(blockedScripts),
        blockScript: blockScriptExecution,
        unblockScript: (scriptUrl) => {
            blockedScripts.delete(scriptUrl);
            updateBlockedScriptsDisplay();
        }
    };
})();