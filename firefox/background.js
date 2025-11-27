// Firefox 兼容性
const isFirefox = typeof browser !== 'undefined';
const runtime = isFirefox ? browser : chrome;
const storage = isFirefox ? browser.storage : chrome.storage;
const tabs = isFirefox ? browser.tabs : chrome.tabs;

// 监听标签页更新 - 在页面加载完成后自动扫描
tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    // 只在页面完全加载且是HTTP/HTTPS页面时执行
    if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http:') || tab.url.startsWith('https:'))) {
        // 给内容脚本一些初始化时间
        setTimeout(() => {
            // 检查是否启用自动发送
            storage.sync.get(['autoSend'], function(result) {
                if (result.autoSend !== false) { // 默认为true
                    handleAutoScan(tabId, tab.url);
                }
            });
        }, 1000);
    }
});

// 监听来自content script的消息
runtime.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    console.log('Background received message:', request.action, request);
    
    if (request.action === "sendScriptsToService") {
        // 处理从content script发送的脚本数据
        handleSendToService(request.data, sender)
            .then(result => {
                sendResponse({success: true, result: result});
            })
            .catch(error => {
                console.error('Send to service error:', error);
                sendResponse({success: false, error: error.message});
            });
        return true; // 保持消息通道开放
    } else if (request.action === "reportFakeWebsite") {
        // 处理仿冒网站上报
        handleFakeWebsiteReport(request.data)
            .then(result => {
                sendResponse({success: true, message: result});
            })
            .catch(error => {
                console.error('Report fake website error:', error);
                sendResponse({success: false, error: error.message});
            });
        return true;
    } else if (request.action === "scriptBlocked") {
        // 处理脚本阻止记录
        handleScriptBlocked(request.data)
            .then(() => {
                sendResponse({success: true});
            })
            .catch(error => {
                console.error('Script blocked error:', error);
                sendResponse({success: false, error: error.message});
            });
        return true;
    } else if (request.action === "getBlockedLogs") {
        // 返回阻止日志
        sendResponse({success: true, logs: blockedScriptsLog});
        return true;
    } else if (request.action === "contentScriptReady") {
        // 内容脚本就绪通知
        console.log('Content script ready in tab:', sender.tab?.id);
        sendResponse({success: true});
        return true;
    }
});

// 处理发送到服务的逻辑
async function handleSendToService(data, sender) {
    try {
        console.log('Sending data to service:', data);
        
        // 获取服务URL设置
        const result = await new Promise(resolve => {
            storage.sync.get(['serviceUrl'], resolve);
        });
        const serviceUrl = result.serviceUrl || 'http://127.0.0.1:8500/checkurl';
        
        console.log('Using service URL:', serviceUrl);
        
        const response = await fetch(serviceUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const resultData = await response.json();
        
        // 更新服务状态为可用
        await new Promise(resolve => {
            storage.sync.set({serviceAvailable: true}, resolve);
        });
        
        // 将分析结果发送回content script
        if (sender && sender.tab) {
            try {
                await new Promise((resolve, reject) => {
                    tabs.sendMessage(sender.tab.id, {
                        action: "analysisResult",
                        data: resultData
                    }, (response) => {
                        if (runtime.runtime.lastError) {
                            reject(runtime.runtime.lastError);
                        } else {
                            resolve(response);
                        }
                    });
                });
                console.log('Analysis result sent to content script');
            } catch (error) {
                console.log('Could not send analysis result to content script:', error);
            }
        }
        
        return resultData;
    } catch (error) {
        console.error('Service communication error:', error);
        // 更新服务状态为不可用
        await new Promise(resolve => {
            storage.sync.set({serviceAvailable: false}, resolve);
        });
        throw error;
    }
}

// 处理仿冒网站上报
async function handleFakeWebsiteReport(data) {
    try {
        console.log('Reporting fake website:', data);
        
        const response = await fetch('http://usg.usersafe.cn/fake.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // 尝试解析响应
        try {
            const result = await response.json();
            return result.message || '上报成功';
        } catch (e) {
            // 如果不是JSON格式，返回成功消息
            return '上报成功';
        }
    } catch (error) {
        console.error('Fake website report error:', error);
        throw error;
    }
}

// 处理脚本阻止记录
async function handleScriptBlocked(blockData) {
    // 添加到日志
    blockedScriptsLog.push(blockData);
    
    // 保持日志大小，只保留最近100条
    if (blockedScriptsLog.length > 100) {
        blockedScriptsLog = blockedScriptsLog.slice(-100);
    }
    
    console.log('Script blocked logged:', blockData);
    
    // 通知popup更新
    try {
        await new Promise((resolve, reject) => {
            runtime.runtime.sendMessage({
                action: "scriptBlockedUpdate",
                data: blockData
            }, (response) => {
                if (runtime.runtime.lastError) {
                    reject(runtime.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
    } catch (error) {
        console.log('Could not send blocked update to popup:', error);
    }
}

// 改进的自动扫描处理
async function handleAutoScan(tabId, url) {
    try {
        console.log('Starting auto scan for tab:', tabId, url);
        
        // 首先检查内容脚本是否就绪
        const isReady = await checkContentScriptReady(tabId);
        console.log('Content script ready:', isReady);
        
        if (isReady) {
            await sendScanCommand(tabId);
        } else {
            // 在 Firefox 中，内容脚本通常通过 manifest 注入
            // 如果未就绪，等待并重试
            await waitForContentScript(tabId);
        }
    } catch (error) {
        console.error('Auto scan error:', error);
        // 在 Firefox 中，我们主要依赖 manifest 注入，所以静默失败是可以的
    }
}

// 检查内容脚本是否就绪 - 改进版本
function checkContentScriptReady(tabId) {
    return new Promise((resolve) => {
        // 设置超时
        const timeout = setTimeout(() => {
            console.log('Content script ping timeout for tab:', tabId);
            resolve(false);
        }, 1000);
        
        tabs.sendMessage(tabId, { action: "ping" }, (response) => {
            clearTimeout(timeout);
            if (runtime.runtime.lastError) {
                console.log('Content script not ready for tab', tabId, ':', runtime.runtime.lastError);
                resolve(false);
            } else {
                console.log('Content script responded for tab', tabId, ':', response);
                resolve(true);
            }
        });
    });
}

// 等待内容脚本就绪
function waitForContentScript(tabId) {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 5;
        
        function check() {
            attempts++;
            checkContentScriptReady(tabId).then(ready => {
                if (ready) {
                    sendScanCommand(tabId).then(resolve);
                } else if (attempts < maxAttempts) {
                    setTimeout(check, 500);
                } else {
                    console.log('Max attempts reached for tab', tabId, ', giving up');
                    resolve();
                }
            });
        }
        
        check();
    });
}

// 发送扫描命令 - 改进版本
function sendScanCommand(tabId) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.log('Scan command timeout for tab:', tabId);
            resolve(false);
        }, 3000);
        
        tabs.sendMessage(tabId, { action: "autoScanAndSend" }, (response) => {
            clearTimeout(timeout);
            if (runtime.runtime.lastError) {
                console.log('Scan command error for tab', tabId, ':', runtime.runtime.lastError);
                resolve(false);
            } else {
                console.log('Scan command success for tab', tabId, ':', response);
                resolve(true);
            }
        });
    });
}

// 健康检查函数
async function checkServiceHealth() {
    try {
        const response = await fetch('http://127.0.0.1:8500/health', {
            method: 'GET'
        });
        
        if (response.ok) {
            await new Promise(resolve => {
                storage.sync.set({serviceAvailable: true}, resolve);
            });
            console.log('Service health check: OK');
            return true;
        } else {
            throw new Error('Service not healthy');
        }
    } catch (error) {
        console.log('Service health check failed:', error);
        await new Promise(resolve => {
            storage.sync.set({serviceAvailable: false}, resolve);
        });
        return false;
    }
}

// 定期检查服务状态
setInterval(checkServiceHealth, 60000); // 每分钟检查一次

// 启动时立即检查
checkServiceHealth().then(healthy => {
    console.log('Initial service health check:', healthy ? 'OK' : 'Failed');
});

let blockedScriptsLog = [];
