// 监听标签页更新 - 在页面加载完成后自动扫描
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    // 只在页面完全加载且是HTTP/HTTPS页面时执行
    if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http:') || tab.url.startsWith('https:'))) {
        // 检查是否启用自动发送
        chrome.storage.sync.get(['autoSend'], function(result) {
            if (result.autoSend !== false) { // 默认为true
                // 使用动态注入替代消息发送
                handleAutoScan(tabId, tab.url);
            }
        });
    }
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "sendScriptsToService") {
        // 处理从content script发送的脚本数据
        handleSendToService(request.data, sender)
            .then(result => {
                sendResponse({success: true, result: result});
            })
            .catch(error => {
                sendResponse({success: false, error: error.message});
            });
        return true;
    } else if (request.action === "reportFakeWebsite") {
        // 处理仿冒网站上报
        handleFakeWebsiteReport(request.data)
            .then(result => {
                sendResponse({success: true, message: result});
            })
            .catch(error => {
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
                sendResponse({success: false, error: error.message});
            });
        return true;
    } else if (request.action === "getBlockedLogs") {
        // 返回阻止日志
        sendResponse({success: true, logs: blockedScriptsLog});
        return true;
    }
});

// 处理发送到服务的逻辑
async function handleSendToService(data, sender) {
    try {
        // 获取服务URL设置
        const result = await chrome.storage.sync.get(['serviceUrl']);
        const serviceUrl = result.serviceUrl || 'http://127.0.0.1:8500/checkurl';
        
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
        await chrome.storage.sync.set({serviceAvailable: true});
        
        // 将分析结果发送回content script
        if (sender && sender.tab) {
            chrome.tabs.sendMessage(sender.tab.id, {
                action: "analysisResult",
                data: resultData
            });
        }
        
        return resultData;
    } catch (error) {
        // 更新服务状态为不可用
        await chrome.storage.sync.set({serviceAvailable: false});
        throw error;
    }
}

// 处理仿冒网站上报
async function handleFakeWebsiteReport(data) {
    try {
        const response = await fetch('http://usg.usersafe.cn/fake.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
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
    
    // 通知popup更新
    chrome.runtime.sendMessage({
        action: "scriptBlockedUpdate",
        data: blockData
    }).catch(() => {
        // 发送阻止更新失败，静默处理
    });
}

// 处理自动扫描的主函数
async function handleAutoScan(tabId, url) {
    try {
        // 首先尝试直接通信
        const isContentScriptReady = await checkContentScriptReady(tabId);
        
        if (isContentScriptReady) {
            // 内容脚本已就绪，直接发送扫描命令
            await sendScanCommand(tabId);
        } else {
            // 内容脚本未就绪，尝试动态注入
            await dynamicallyInjectContentScript(tabId);
        }
    } catch (error) {
        // 最后的重试机制
        await finalRetryMechanism(tabId);
    }
}

// 检查内容脚本是否就绪
function checkContentScriptReady(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
            if (chrome.runtime.lastError) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

// 发送扫描命令
function sendScanCommand(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: "autoScanAndSend" }, (response) => {
            if (chrome.runtime.lastError) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

// 动态注入内容脚本
function dynamicallyInjectContentScript(tabId) {
    return new Promise((resolve, reject) => {
        // 检查是否有 scripting 权限
        if (!chrome.scripting) {
            reject(new Error('Missing scripting permission'));
            return;
        }

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        }, (results) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            
            // 等待内容脚本初始化
            setTimeout(() => {
                checkContentScriptReady(tabId)
                    .then((ready) => {
                        if (ready) {
                            return sendScanCommand(tabId);
                        }
                        return false;
                    })
                    .then(resolve)
                    .catch(reject);
            }, 500);
        });
    });
}

// 最终重试机制
async function finalRetryMechanism(tabId) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const success = await checkContentScriptReady(tabId);
            if (success) {
                await sendScanCommand(tabId);
                return;
            }
        } catch (error) {
            // 重试失败，静默处理
        }
        
        // 等待一段时间再重试
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
}

// 健康检查函数
async function checkServiceHealth() {
    try {
        const response = await fetch('http://127.0.0.1:8500/health', {
            method: 'GET'
        });
        
        if (response.ok) {
            await chrome.storage.sync.set({serviceAvailable: true});
            return true;
        } else {
            throw new Error('Service not healthy');
        }
    } catch (error) {
        await chrome.storage.sync.set({serviceAvailable: false});
        return false;
    }
}

// 定期检查服务状态
setInterval(checkServiceHealth, 60000); // 每分钟检查一次
checkServiceHealth(); // 启动时立即检查

let blockedScriptsLog = [];
