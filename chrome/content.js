// 内容脚本 - 在页面中运行，检测脚本
(function() {
    'use strict';

    let analyzedScripts = new Set(); // 记录已分析的脚本，避免重复发送
    let blockedScripts = new Set(); // 记录被阻止的脚本

    // 监听来自background的消息
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === "scanScripts") {
            const scripts = scanAllScripts();
            sendResponse({scripts: scripts});
        } else if (request.action === "autoScanAndSend") {
            // 自动扫描并发送
            autoScanAndSend();
            sendResponse({success: true});
        } else if (request.action === "analysisResult") {
            // 接收分析结果，可以更新页面显示
            handleAnalysisResult(request.data);
            sendResponse({success: true});
        } else if (request.action === "ping") {
            // 响应background的ping请求
            sendResponse({status: "ready"});
        } else if (request.action === "getBlockedScripts") {
            // 返回被阻止的脚本列表
            sendResponse({blockedScripts: Array.from(blockedScripts)});
        }
        return true;
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
            const response = await chrome.runtime.sendMessage({
                action: "sendScriptsToService",
                data: payload
            });
            
            if (response && response.success) {
                showMessage(`已发送 ${newScripts.length} 个脚本进行分析`, 'success');
            } else if (response && response.error) {
                showMessage('发送到分析服务失败', 'error');
            }
        } catch (error) {
            showMessage('连接到分析服务失败', 'error');
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
        chrome.runtime.sendMessage({
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
        
        const icon = getNotificationIcon(type);
        notification.innerHTML = `
            <div style="display: flex; align-items: center;">
                <span style="font-size: 16px; margin-right: 8px;">${icon}</span>
                <span>${message}</span>
            </div>
        `;
        
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
        const mediumRiskScripts = results.filter(r => r.riskLevel === 'medium');
        
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
            
            // 方法3: 重写fetch和XMLHttpRequest来拦截脚本加载
            interceptScriptRequests(scriptUrl);
            
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

    // 拦截脚本网络请求
    function interceptScriptRequests(scriptUrl) {
        // 拦截fetch请求
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            const url = args[0];
            if (typeof url === 'string' && url.includes(scriptUrl)) {
                return Promise.reject(new Error('Script blocked by security extension'));
            }
            return originalFetch.apply(this, args);
        };
        
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
        chrome.runtime.sendMessage({
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
            blockedList.innerHTML = `
                <div style="font-weight: bold; color: #d32f2f; margin-bottom: 8px;">
                    ⚠️ 已阻止 ${blockedScripts.size} 个高风险脚本
                </div>
                <div style="color: #666; font-size: 11px;">
                    ${Array.from(blockedScripts).map(url => 
                        `• ${extractDomain(url)}`
                    ).join('<br>')}
                </div>
            `;
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
                        if (blockedScripts.has(node.src)) {
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
                            if (blockedScripts.has(script.src)) {
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

    // 显示消息（简化版）
    function showMessage(message, type) {
        // 静默模式，不显示控制台消息
    }

    // 页面加载完成后初始化
    function initialize() {
        // 初始扫描
        setTimeout(() => {
            autoScanAndSend();
        }, 3000);
        
        // 开始监听动态脚本
        observeDynamicScripts();
        
        // 发送就绪信号到background
        chrome.runtime.sendMessage({action: "contentScriptReady"})
            .catch(() => {
                // Background未就绪，静默处理
            });
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
