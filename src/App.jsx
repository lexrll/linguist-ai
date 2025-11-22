import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  BookOpen, 
  Wand2, 
  CheckCircle2, 
  AlertCircle, 
  Copy, 
  Highlighter, 
  Eraser, 
  Zap,
  ChevronRight,
  Sparkles,
  GraduationCap,
  Camera,
  Loader2,
  ClipboardCheck,
  Key,
  Settings,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// --- 常量与配置 ---
const APP_NAME = "LinguistAI 灵犀写作";
const MAX_CHARS = 5000;
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
const MAX_RETRIES = 3;

// 模拟的演示文本
const DEMO_TOPIC = "Some people think that success is the result of hard work. Others think that it is a matter of luck. Discuss both views.";
const DEMO_TEXT = `I has a very big dream that one days I will goes to America. 
The weather inside my city are vary hot, but I like it despite. 
Basically, I think education is important stuff for success, but luck is also need.`;


// --- 工具函数 ---

/**
 * 移除可能包裹 JSON 的 Markdown 围栏 (```json ... ```)
 * @param {string} text 包含 JSON 的字符串
 * @returns {string} 纯净的 JSON 字符串
 */
const cleanJsonString = (text) => {
    if (!text) return '{}';
    // 移除开头和结尾的 Markdown 围栏
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) {
        cleaned = cleaned.substring(7).trim();
    }
    if (cleaned.endsWith('```')) {
        cleaned = cleaned.substring(0, cleaned.length - 3).trim();
    }
    return cleaned;
};


// --- API 交互逻辑 ---

// 1. 图片识别 (OCR)
const transcribeImage = async (base64Image, mimeType, currentApiKey, setErrorMessage) => {
  const apiKey = currentApiKey || ""; 
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

  setErrorMessage(null);

  const prompt = "Please transcribe the text from this image and return only the raw, recognized text content, without any commentary or formatting.";

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Image
          }
        }
      ]
    }],
  };
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) return text.trim();
            
            throw new Error("Received empty or malformed response from API.");

        } catch (error) {
            if (i < MAX_RETRIES - 1) {
                const delay = Math.pow(2, i) * 1000;
                console.warn(`OCR Call failed. Retrying in ${delay / 1000}s...`, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error("OCR API Call failed after all retries:", error);
                setErrorMessage(`图片识别失败 (Error: ${error.message}). 请检查您的 API Key 是否有效。`);
                return null;
            }
        }
    }
};

// 2. 润色与分析 (FIXED: Added JSON cleanup)
const fetchImprovedText = async (text, analysisTarget, difficulty, userPrompt, currentApiKey, setErrorMessage) => {
  const apiKey = currentApiKey || "";
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

  setErrorMessage(null); 

  const systemPrompt = `You are a world-class AI writing and revision assistant. Your task is to analyze, correct, and improve the user's provided text based on the specified target and difficulty.
You MUST return a single JSON object structured exactly according to the provided schema. DO NOT include any explanatory text or markdown fences (like \`\`\`json) outside the JSON object.
The language of the output (summary, issues, and improved text) must be the same as the user's input text (or the specified target language).
The analysis and improvement should be strictly professional and constructive.
1. The 'summary' must provide a brief, high-level assessment.
2. The 'issues' array must contain ALL identified grammar, spelling, and style errors.
3. The 'improved_full_text' must be the fully revised and polished version of the original text.
`;

  const fullPrompt = `Analyze and improve the following text. 

**Original Text:**
---
${text}
---

**Revision Goal:**
- **Target Audience/Genre:** ${analysisTarget}
- **Difficulty/Level:** ${difficulty}
- **Specific Instructions:** ${userPrompt || 'None'}

Please provide a structured response in the following JSON format.`;


  const responseSchema = {
    type: "OBJECT",
    properties: {
      summary: {
        type: "OBJECT",
        description: "High-level summary of the original text's main points and overall quality.",
        properties: {
          original_text: {
            type: "STRING",
            description: "A one-sentence summary of the original text's content."
          },
          overall_assessment: {
            type: "STRING",
            description: "A constructive, one-sentence assessment of the text's current state (e.g., 'The ideas are clear but the grammar needs improvement.')."
          }
        },
        propertyOrdering: ["original_text", "overall_assessment"]
      },
      issues: {
        type: "ARRAY",
        description: "A list of grammar, spelling, or stylistic issues found in the original text, including the necessary correction.",
        items: {
          type: "OBJECT",
          properties: {
            type: {
              type: "STRING",
              enum: ["Grammar", "Spelling", "Punctuation", "Style", "Clarity"],
              description: "The type of issue."
            },
            original_phrase: {
              type: "STRING",
              description: "The exact phrase or word from the original text that needs correction."
            },
            correction: {
              type: "STRING",
              description: "The corrected or improved phrase/word."
            },
            explanation: {
              type: "STRING",
              description: "A brief, helpful explanation of the error and correction (e.g., 'Verb tense mismatch' or 'More formal vocabulary')."
            }
          },
          propertyOrdering: ["type", "original_phrase", "correction", "explanation"]
        }
      },
      improved_full_text: {
        type: "STRING",
        description: "The complete, fully revised and polished version of the original text, incorporating all corrections and improvements."
      }
    },
    required: ["summary", "issues", "improved_full_text"],
    propertyOrdering: ["summary", "issues", "improved_full_text"]
  };

  const payload = {
    contents: [{
      parts: [{ text: fullPrompt }]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.5,
    },
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    }
  };

  for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
    
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
    
        const result = await response.json();
        const rawJsonString = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
        if (!rawJsonString) {
          throw new Error("Received empty or malformed response from API.");
        }
        
        // --- FIX: Clean the string before parsing ---
        const jsonToParse = cleanJsonString(rawJsonString);
        
        const parsedJson = JSON.parse(jsonToParse);
        return parsedJson;

      } catch (error) {
        if (i < MAX_RETRIES - 1) {
            const delay = Math.pow(2, i) * 1000;
            console.warn(`Revision API Call failed. Retrying in ${delay / 1000}s...`, error);
            await new Promise(resolve => setTimeout(resolve, delay));
        } else {
            console.error("Revision API Call failed after all retries:", error);
            if (error.message.includes("400")) {
              setErrorMessage("API 请求失败 (状态码 400)。请检查文本内容或模型设置。");
            } else if (error.message.includes("JSON")) {
              setErrorMessage("API 返回格式错误，请稍后重试。 (模型可能添加了额外的Markdown符号)");
            } else {
              setErrorMessage(`润色请求失败：${error.message}`);
            }
            return null;
        }
      }
  }
};


// --- 主应用组件 ---
export default function App() {
  const [inputText, setInputText] = useState(DEMO_TEXT);
  const [analysisTarget, setAnalysisTarget] = useState('Academic Essay (E.g., IELTS/TOEFL)');
  const [difficulty, setDifficulty] = useState('College/Advanced');
  const [userPrompt, setUserPrompt] = useState('');
  const [activeTab, setActiveTab] = useState('summary'); // 'summary', 'issues', 'revised'

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const fileInputRef = useRef(null);

  // 复制提示状态和逻辑
  const [copiedMessage, setCopiedMessage] = useState(null);
  
  // --- 新增状态用于 API Key 和设置 ---
  const [userApiKey, setUserApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  
  // --- Firebase Auth 状态 ---
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState(null);
  const authRef = useRef(null);
  
  // 1. Firebase 初始化与认证 (Mandatory Setup)
  useEffect(() => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

    if (!firebaseConfig) {
        console.error("Firebase configuration not available.");
        setAuthReady(true);
        return;
    }

    try {
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app); 
        authRef.current = auth; 

        const signIn = async () => {
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Firebase Sign-In Failed:", error);
            }
        };

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                setUserId(crypto.randomUUID()); 
            }
            setAuthReady(true);
        });

        signIn();
        return () => unsubscribe();
    } catch (e) {
        console.error("Firebase Initialization Error:", e);
        setAuthReady(true);
    }
  }, []);

  /**
   * 安全地将文本复制到剪贴板，并显示临时提示。
   * @param {string} text 要复制的文本。
   * @param {string} messageKey 提示信息的唯一键。
   */
  const copyToClipboard = useCallback((text, messageKey) => {
    try {
      // 使用 document.execCommand('copy') 作为 iframe 环境下的兼容方案
      const textArea = document.createElement('textarea');
      textArea.value = text;
      // 使其不可见，但仍可选择
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();

      // 检查浏览器是否支持
      if (document.execCommand('copy')) {
        document.execCommand('copy');
        setCopiedMessage(messageKey);
        setTimeout(() => setCopiedMessage(null), 2000);
      } else {
        console.warn('Fallback copy method failed.');
      }
      document.body.removeChild(textArea);
    } catch (err) {
      console.error('Copy failed:', err);
      setErrorMessage('复制失败，请手动复制。');
    }
  }, []);

  const handleTranscribe = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        // DataURL looks like: data:image/png;base64,...
        const dataUrl = reader.result;
        const [mimeTypePart, dataPart] = dataUrl.split(';');
        const mimeType = mimeTypePart.split(':')[1];
        const base64Image = dataPart.split(',')[1];


        setIsLoading(true);
        const recognizedText = await transcribeImage(base64Image, mimeType, userApiKey, setErrorMessage);
        setIsLoading(false);
        event.target.value = ''; // 清空文件输入，以便再次选择相同文件

        if (recognizedText) {
          setInputText(recognizedText);
        }
      };
      reader.readAsDataURL(file);
    }
  };


  const handleRevision = async () => {
    if (!inputText.trim()) {
      setErrorMessage("请输入需要润色的文本！");
      return;
    }
    if (inputText.length > MAX_CHARS) {
      setErrorMessage(`文本长度不能超过 ${MAX_CHARS} 个字符。`);
      return;
    }

    setResult(null);
    setIsLoading(true);
    setErrorMessage(null);

    const data = await fetchImprovedText(
      inputText,
      analysisTarget,
      difficulty,
      userPrompt,
      userApiKey, // Pass userApiKey here
      setErrorMessage
    );

    setIsLoading(false);

    if (data) {
      setResult(data);
      setActiveTab('summary'); // 默认切换到总结标签页
    }
  };

  // UI 结构
  const tabClasses = (tabKey) =>
    `px-4 py-2 text-sm font-medium transition-colors rounded-t-lg ${
      activeTab === tabKey
        ? 'bg-white text-indigo-700 border-b-2 border-indigo-500'
        : 'text-slate-500 hover:text-indigo-600 hover:bg-slate-50'
    }`;

  const buttonClasses = "flex items-center justify-center gap-2 px-6 py-3 font-semibold rounded-xl transition-all shadow-md active:shadow-sm";

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8 font-['Inter']">
      
      {/* 顶部导航和设置按钮 */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold text-indigo-600 flex items-center gap-2">
            <GraduationCap className="w-6 h-6" />
            {APP_NAME}
            {userId && <span className="text-xs font-mono text-slate-400 ml-2">UID: {userId}</span>}
          </h1>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-full text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            aria-label="设置"
          >
            <Settings className="w-6 h-6" />
          </button>
        </div>
      </header>
      
      {/* API Key 设置面板 */}
      <div 
        className={`bg-indigo-50 border-b border-indigo-200 transition-all duration-300 overflow-hidden ${showSettings ? 'max-h-40 py-4' : 'max-h-0'}`}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-white shadow-md border border-indigo-100">
            <Key className="w-5 h-5 text-indigo-500 flex-shrink-0" />
            <input
              type="password"
              placeholder="输入您的 Gemini API Key (可选，留空则使用默认配置)"
              value={userApiKey}
              onChange={(e) => setUserApiKey(e.target.value.trim())}
              className="flex-grow p-2 text-sm border border-slate-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <button
              onClick={() => {
                setUserApiKey('');
              }}
              className="text-xs font-medium text-red-600 hover:bg-red-50 px-3 py-1.5 rounded transition-colors"
            >
              清除
            </button>
          </div>
          {userApiKey && (
            <p className="text-xs text-indigo-600 mt-2 text-center">
              您正在使用自定义 API Key 进行调用。
            </p>
          )}
        </div>
      </div>
      
      {/* 复制成功提示 */}
      {copiedMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center p-3 text-sm font-medium text-white bg-indigo-600 rounded-lg shadow-xl transition-all duration-300">
          <ClipboardCheck size={16} className="mr-2" />
          {copiedMessage === 'summary' && '总结已复制！'}
          {copiedMessage === 'issues' && '问题列表已复制！'}
          {copiedMessage === 'full' && '全文已复制！'}
        </div>
      )}
      
      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
        {/* 左侧：输入与配置区域 */}
        <div className="space-y-6">
          {/* 输入文本区域 */}
          <div className="bg-white p-6 rounded-2xl shadow-xl border border-indigo-100">
            <h2 className="flex items-center text-xl font-bold text-slate-700 mb-4">
              <BookOpen size={20} className="mr-2 text-indigo-500" />
              待润色文本 (最多 {MAX_CHARS} 字符)
            </h2>
            {/* 题目输入，用于上下文参考 */}
            <label htmlFor="topic" className="block text-sm font-medium text-slate-700 mb-1">作文题目 (仅供参考)</label>
            <textarea
                id="topic"
                rows="2"
                value={DEMO_TOPIC} // 保持固定或可编辑，这里先保持固定
                readOnly
                placeholder="作文题目"
                className="w-full p-3 border border-slate-200 rounded-lg bg-gray-50 text-slate-500 transition-shadow resize-none mb-4"
              />
            
            <textarea
              className="w-full h-64 p-4 text-sm border border-slate-300 rounded-lg resize-none focus:ring-indigo-500 focus:border-indigo-500 custom-scrollbar"
              placeholder="在这里输入你的文本..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              maxLength={MAX_CHARS}
            ></textarea>
            <div className="flex justify-between items-center mt-3 text-xs text-slate-500">
              <span>当前字数: {inputText.length}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTranscribe}
                  disabled={isLoading}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded transition-colors ${isLoading ? 'bg-gray-100 text-gray-400' : 'text-indigo-600 hover:bg-indigo-50'}`}
                >
                  <Camera size={14} />
                  从图片识别
                </button>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                />
              </div>
            </div>
          </div>

          {/* 润色选项配置 */}
          <div className="bg-white p-6 rounded-2xl shadow-xl border border-indigo-100">
            <h2 className="flex items-center text-xl font-bold text-slate-700 mb-4">
              <Wand2 size={20} className="mr-2 text-indigo-500" />
              润色目标配置
            </h2>
            <div className="space-y-4">
              {/* 目标受众/文体 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  目标受众/文体
                </label>
                <select
                  value={analysisTarget}
                  onChange={(e) => setAnalysisTarget(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500"
                  disabled={isLoading}
                >
                  <option>Academic Essay (E.g., IELTS/TOEFL)</option>
                  <option>Business Email/Report</option>
                  <option>Creative Story/Poem</option>
                  <option>Casual Conversation/Social Media</option>
                  <option>Technical Documentation</option>
                </select>
              </div>

              {/* 难度/水平 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  难度/水平
                </label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500"
                  disabled={isLoading}
                >
                  <option>Elementary/A2</option>
                  <option>Intermediate/B1-B2</option>
                  <option>College/Advanced</option>
                  <option>Native/Professional</option>
                </select>
              </div>

              {/* 额外指令 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  额外指令 (可选)
                </label>
                <textarea
                  className="w-full p-2 h-16 text-sm border border-slate-300 rounded-lg resize-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="例如：请使用更专业的词汇；保持幽默的语气；字数增加到200字以上。"
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  disabled={isLoading}
                ></textarea>
              </div>

            </div>
          </div>

          {/* 润色按钮 */}
          <button
            onClick={handleRevision}
            disabled={isLoading || !inputText.trim() || inputText.length > MAX_CHARS}
            className={`${buttonClasses} w-full ${isLoading ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
          >
            {isLoading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                正在智能润色...
              </>
            ) : (
              <>
                <Zap size={20} />
                开始润色与分析
              </>
            )}
          </button>

          {/* 错误提示 */}
          {errorMessage && (
            <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-xl flex items-center gap-3 shadow-md">
              <AlertCircle size={20} className="flex-shrink-0" />
              <span className="text-sm font-medium">{errorMessage}</span>
            </div>
          )}
        </div>

        {/* 右侧：结果展示区域 */}
        <div className="space-y-6">
          {/* 默认提示或加载状态 */}
          {!result && !isLoading && (
            <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-200 h-full flex flex-col items-center justify-center text-center">
              <GraduationCap size={48} className="text-indigo-400 mb-4" />
              <h2 className="text-xl font-bold text-slate-700 mb-2">等待您的文本分析</h2>
              <p className="text-slate-500 text-sm max-w-sm">
                输入您的文本和润色配置，灵犀写作将为您提供详细的语法修正、风格改进和全文润色。
              </p>
            </div>
          )}

          {/* 加载状态 */}
          {!result && isLoading && (
            <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-200 h-full flex flex-col items-center justify-center text-center">
              <Loader2 size={48} className="text-indigo-500 animate-spin mb-4" />
              <h2 className="text-xl font-bold text-slate-700">AI 正在努力工作中...</h2>
              <p className="text-slate-500 text-sm">正在生成详细的分析和润色后的文本，请稍候。</p>
            </div>
          )}

          {/* 结果展示 */}
          {result && (
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200">
              {/* Tab 导航 */}
              <div className="p-4 border-b border-slate-200 bg-gray-50 rounded-t-2xl">
                <div className="flex space-x-2">
                  <button onClick={() => setActiveTab('summary')} className={tabClasses('summary')}>
                    <CheckCircle2 size={16} className="inline mr-1" />
                    总结与评估
                  </button>
                  <button onClick={() => setActiveTab('issues')} className={tabClasses('issues')}>
                    <Highlighter size={16} className="inline mr-1" />
                    问题与修正 ({result.issues.length})
                  </button>
                  <button onClick={() => setActiveTab('revised')} className={tabClasses('revised')}>
                    <Eraser size={16} className="inline mr-1" />
                    全文润色
                  </button>
                </div>
              </div>

              <div className="p-6">
                {/* 1. 总结与评估 */}
                {activeTab === 'summary' && (
                  <div className="space-y-4">
                    <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-200">
                      <h3 className="text-sm font-semibold text-indigo-700 mb-2 flex items-center">
                        <ChevronRight size={16} className="mr-1" />
                        原文内容总结
                      </h3>
                      <p className="text-slate-700 text-sm leading-relaxed">
                        {result.summary.original_text}
                      </p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-xl border border-green-200">
                      <h3 className="text-sm font-semibold text-green-700 mb-2 flex items-center">
                        <ChevronRight size={16} className="mr-1" />
                        总体评估
                      </h3>
                      <p className="text-slate-700 text-sm leading-relaxed">
                        {result.summary.overall_assessment}
                      </p>
                    </div>

                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={() => copyToClipboard(
                          `原文总结: ${result.summary.original_text}\n总体评估: ${result.summary.overall_assessment}`,
                          'summary'
                        )}
                        className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded transition-colors"
                      >
                        <Copy size={14} />
                        复制总结
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. 问题与修正 */}
                {activeTab === 'issues' && (
                  <div className="space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                    {result.issues.length === 0 ? (
                      <div className="p-4 text-center text-slate-500 bg-gray-50 rounded-xl">
                        太棒了！AI 没有发现明显的语法或拼写错误。
                      </div>
                    ) : (
                      <>
                        {result.issues.map((issue, index) => (
                          <div key={index} className="p-4 border-l-4 border-red-400 bg-red-50 rounded-r-lg shadow-sm">
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-xs font-bold text-red-700 bg-red-200 px-2 py-0.5 rounded-full">
                                {issue.type}
                              </span>
                            </div>
                            <p className="text-sm text-slate-700 mb-1">
                              <span className="font-medium text-red-800 mr-2">原文:</span>
                              <span className="bg-yellow-200 p-1 rounded italic">{issue.original_phrase}</span>
                            </p>
                            <p className="text-sm text-slate-700 mb-2">
                              <span className="font-medium text-green-800 mr-2">修正:</span>
                              <span className="bg-green-200 p-1 rounded font-semibold">{issue.correction}</span>
                            </p>
                            <p className="text-xs text-slate-600">
                              <span className="font-medium text-slate-800 mr-1">解释:</span>
                              {issue.explanation}
                            </p>
                          </div>
                        ))}
                        <div className="mt-6 flex justify-end">
                          <button
                            onClick={() => copyToClipboard(
                              JSON.stringify(result.issues, null, 2),
                              'issues'
                            )}
                            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded transition-colors"
                          >
                            <Copy size={14} />
                            复制问题列表 (JSON)
                          </button>
                        </div>
                      </>
                     )}
                  </div>
                )}

                {/* 3. 全文润色 */}
                {activeTab === 'revised' && (
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <p className="text-slate-700 leading-loose whitespace-pre-wrap">
                      {result.improved_full_text}
                    </p>
                    <div className="mt-6 flex justify-end">
                      <button 
                        onClick={() => copyToClipboard(result.improved_full_text, 'full')}
                        className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded transition-colors"
                      >
                        <Copy size={14} />
                        复制全文
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 自定义滚动条样式，提高可见性 */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
      `}</style>
    </div>
  );
}