import React, { useState, useRef } from 'react';
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
  Upload,
  Image as ImageIcon,
  Loader2
} from 'lucide-react';

// --- 常量与配置 ---
const APP_NAME = "LinguistAI 灵犀写作";
const MAX_CHARS = 5000;
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";

// 模拟的演示文本
const DEMO_TOPIC = "Some people think that success is the result of hard work. Others think that it is a matter of luck. Discuss both views.";
const DEMO_TEXT = `I has a very big dream that one days I will goes to America. 
The weather inside my city are vary hot, but I like it despite. 
Basically, I think education is important stuff for success, but luck is also need.`;

// --- API 交互逻辑 ---

// 1. 图片识别 (OCR)
const transcribeImage = async (base64Image, mimeType) => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [
        { text: "Please transcribe the handwritten or printed English text from this image exactly as is. Do not correct any grammar errors yet, just return the raw text." },
        { 
          inlineData: {
            mimeType: mimeType,
            data: base64Image
          }
        }
      ]
    }]
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error("Image recognition failed");
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (error) {
    console.error("OCR Error:", error);
    throw error;
  }
};

// 2. 分析功能 (支持题目上下文)
const generateAnalysis = async (text, topic) => {
  const apiKey = ""; 
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

  const systemPrompt = `
    You are an expert IELTS/TOEFL English writing coach.
    Analyze the user's text for grammar, vocabulary, coherence, style, AND Task Response (relevance to the topic).
    
    Topic/Prompt provided by user: "${topic || 'No specific topic provided'}"

    STRICT RESPONSE FORMAT:
    You MUST return ONLY a valid JSON object. Do not wrap it in markdown code blocks.
    
    JSON Structure:
    {
      "score": number (0-100),
      "level": string (e.g., "A2", "B1", "C1"),
      "task_response_check": "Brief evaluation in Chinese: Does the essay address the topic? Is it off-topic?",
      "summary": "A brief, encouraging summary in Chinese about the writing.",
      "corrections": [
        {
          "original": "exact substring from text",
          "corrected": "improved version",
          "type": "Grammar" | "Vocabulary" | "Style" | "Coherence",
          "explanation": "Short explanation in Chinese why this change is better."
        }
      ],
      "vocabulary_enhancements": [
        {
          "original": "simple word from text",
          "better": "advanced synonym",
          "reason": "Brief Chinese explanation of nuance."
        }
      ],
      "improved_full_text": "The completely rewritten, polished version of the essay."
    }
  `;

  const payload = {
    contents: [{
      parts: [{ text: `${systemPrompt}\n\nUser Text to Analyze:\n${text}` }]
    }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawText) throw new Error("No response from AI");

    const jsonString = rawText.replace(/```json|```/g, '').trim();
    return JSON.parse(jsonString);

  } catch (error) {
    console.error("Analysis failed:", error);
    throw error;
  }
};

// 3. 续写功能
const generateContinuation = async (currentText, topic) => {
  const apiKey = ""; 
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

  const systemPrompt = `
    You are a helpful English writing assistant. 
    Context/Topic: "${topic || 'General writing'}"
    Read the user's current text and generate the next 1-3 sentences to continue the essay naturally.
    Ensure the continuation stays relevant to the topic.
    Return ONLY the new text string.
  `;

  const payload = {
    contents: [{
      parts: [{ text: `${systemPrompt}\n\nCurrent Text:\n${currentText}` }]
    }],
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error("Continuation failed");
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (error) {
    console.error(error);
    return "";
  }
};

// --- 组件：修正建议卡片 ---
const CorrectionCard = ({ item, onClick }) => {
  const typeColors = {
    Grammar: "bg-red-100 text-red-700 border-red-200",
    Vocabulary: "bg-blue-100 text-blue-700 border-blue-200",
    Style: "bg-amber-100 text-amber-700 border-amber-200",
    Coherence: "bg-purple-100 text-purple-700 border-purple-200",
  };

  return (
    <div 
      onClick={onClick}
      className="group bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer mb-3"
    >
      <div className="flex justify-between items-start mb-2">
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${typeColors[item.type] || "bg-gray-100"}`}>
          {item.type}
        </span>
      </div>
      
      <div className="flex items-center gap-2 text-sm mb-2">
        <span className="line-through text-slate-400 decoration-red-300 decoration-2">{item.original}</span>
        <ChevronRight size={14} className="text-slate-300" />
        <span className="font-semibold text-green-600 bg-green-50 px-1 rounded">{item.corrected}</span>
      </div>
      
      <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-50 pt-2 mt-2">
        💡 {item.explanation}
      </p>
    </div>
  );
};

// --- 组件：词汇升级卡片 ---
const VocabCard = ({ item }) => {
  return (
    <div className="bg-white p-4 rounded-xl border border-blue-50 shadow-sm hover:shadow-md hover:border-blue-200 transition-all mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-slate-500 line-through text-sm">{item.original}</span>
          <ChevronRight size={14} className="text-blue-300" />
          <span className="font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-sm">{item.better}</span>
        </div>
      </div>
      <p className="text-xs text-slate-500">✨ {item.reason}</p>
    </div>
  );
};

// --- 主应用程序 ---
export default function App() {
  const [text, setText] = useState("");
  const [topic, setTopic] = useState(""); // 新增：作文题目状态
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false); // 分析中
  const [ocrLoading, setOcrLoading] = useState(false); // 图片识别中
  const [continuing, setContinuing] = useState(false); // 续写中
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('editor'); 

  const fileInputRef = useRef(null);

  // 分析全文
  const handleAnalyze = async () => {
    if (!text.trim() || text.length < 10) {
      setError("请至少输入 10 个字符");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await generateAnalysis(text, topic); // 传入 topic
      setResult(data);
    } catch (err) {
      setError("分析失败，请稍后再试或检查网络。");
    } finally {
      setLoading(false);
    }
  };

  // 智能续写
  const handleSmartContinue = async () => {
    if (!text.trim()) {
      setError("请先写一点内容，我才能帮您续写。");
      return;
    }
    setContinuing(true);
    try {
      const newText = await generateContinuation(text, topic);
      if (newText) {
        setText(prev => prev + (prev.endsWith(' ') ? '' : ' ') + newText);
      }
    } catch (err) {
      setError("续写失败，请重试。");
    } finally {
      setContinuing(false);
    }
  };

  // 图片上传与识别
  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError("请上传图片文件");
      return;
    }

    setOcrLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64String = reader.result.split(',')[1];
        const extractedText = await transcribeImage(base64String, file.type);
        if (extractedText) {
          // 将识别出的文字追加到当前文本后
          setText(prev => prev ? prev + "\n\n" + extractedText : extractedText);
        } else {
          setError("未能从图片中识别出文字，请尝试更清晰的图片。");
        }
      } catch (err) {
        setError("图片识别失败: " + err.message);
      } finally {
        setOcrLoading(false);
        // 清空 input 允许重复上传同一文件
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const loadDemo = () => {
    setText(DEMO_TEXT);
    setTopic(DEMO_TOPIC);
    setError(null);
  };

  const clearText = () => {
    setText("");
    setTopic("");
    setResult(null);
    setError(null);
  };

  const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {/* 顶部导航 */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <BookOpen size={18} />
            </div>
            <span className="font-bold text-xl tracking-tight text-slate-900 hidden sm:inline">{APP_NAME}</span>
            <span className="font-bold text-xl tracking-tight text-slate-900 sm:hidden">LinguistAI</span>
          </div>
          <div className="flex items-center gap-4">
             <button className="text-sm text-slate-500 hover:text-indigo-600 hidden sm:block">帮助</button>
             <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm">
                U
             </div>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* 左侧：编辑器区域 */}
        <div className="flex flex-col h-[calc(100vh-120px)] min-h-[600px]">
          
          {/* 新增：作文题目输入区域 */}
          <div className="bg-white p-4 rounded-t-2xl border border-slate-200 border-b-0">
             <label className="block text-xs font-bold text-slate-500 uppercase mb-1 tracking-wider">
               作文题目 (Topic / Prompt)
             </label>
             <input 
                type="text" 
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例如：Some people say that... (输入题目有助于 AI 判断是否跑题)"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-400"
             />
          </div>

          <div className="bg-white rounded-b-2xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden relative group">
            
            {/* 编辑器工具栏 */}
            <div className="h-12 border-b border-t border-slate-100 flex items-center justify-between px-4 bg-slate-50/50">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <span className="bg-slate-200 px-2 py-0.5 rounded text-slate-600">英语</span>
                <span>{wordCount} 词</span>
              </div>
              <div className="flex items-center gap-2">
                {/* 隐藏的文件上传 input */}
                <input 
                  type="file" 
                  accept="image/*" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={handleImageUpload}
                />
                
                {/* 拍照/上传按钮 */}
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={ocrLoading}
                  className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-slate-200 text-slate-600 rounded transition-colors"
                  title="拍照或上传图片识别文字"
                >
                  {ocrLoading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                  <span className="text-xs font-medium hidden sm:inline">拍照识别</span>
                </button>

                {/* 续写按钮 */}
                <button 
                  onClick={handleSmartContinue}
                  disabled={continuing || !text}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border transition-all
                    ${continuing 
                      ? 'bg-amber-50 text-amber-600 border-amber-200' 
                      : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300'}
                  `}
                >
                  {continuing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  {continuing ? "构思中..." : "AI 续写"}
                </button>

                <div className="h-4 w-[1px] bg-slate-300 mx-1"></div>

                <button onClick={loadDemo} className="p-1.5 hover:bg-slate-100 text-slate-500 rounded transition-colors" title="加载示例">
                  <span className="text-xs font-medium">示例</span>
                </button>
                <button onClick={clearText} className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded transition-colors" title="清空">
                  <Eraser size={16} />
                </button>
              </div>
            </div>

            {/* 文本输入框 + 加载遮罩 */}
            <div className="relative flex-1">
              <textarea
                className="w-full h-full p-6 resize-none outline-none text-lg leading-relaxed text-slate-700 placeholder:text-slate-300"
                placeholder="在此输入、粘贴您的作文，或者点击上方“拍照识别”直接导入图片..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={MAX_CHARS}
                spellCheck="false"
              />
              {/* OCR 加载时的遮罩 */}
              {ocrLoading && (
                <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center backdrop-blur-sm z-10">
                  <Loader2 size={40} className="text-indigo-600 animate-spin mb-3" />
                  <p className="text-slate-600 font-medium">正在识别图片中的文字...</p>
                </div>
              )}
            </div>
            
            {/* 底部操作区 */}
            <div className="p-4 border-t border-slate-100 bg-white absolute bottom-0 w-full flex justify-between items-center z-20">
              <div className="text-xs text-slate-400 hidden sm:block">
                {text.length}/{MAX_CHARS} 字符
              </div>
              <button
                onClick={handleAnalyze}
                disabled={loading || ocrLoading || !text}
                className={`
                  flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-white shadow-lg shadow-indigo-200 transition-all ml-auto
                  ${loading || !text 
                    ? 'bg-slate-300 cursor-not-allowed shadow-none' 
                    : 'bg-indigo-600 hover:bg-indigo-700 hover:translate-y-[-1px] active:translate-y-[1px]'}
                `}
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>深度分析中...</span>
                  </>
                ) : (
                  <>
                    <Wand2 size={18} />
                    <span>开始润色</span>
                  </>
                )}
              </button>
            </div>
          </div>
          
          {error && (
            <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>

        {/* 右侧：分析结果区域 */}
        <div className="flex flex-col h-[calc(100vh-120px)] min-h-[600px]">
          {!result ? (
            // 空状态 / 引导页
            <div className="flex-1 bg-white rounded-2xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-center p-8">
              <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-200 mb-4">
                <Zap size={32} />
              </div>
              <h3 className="text-lg font-semibold text-slate-700 mb-2">准备就绪</h3>
              <p className="text-slate-500 max-w-xs text-sm mb-6">
                LinguistAI 可以为您提供雅思级评分、逐句纠错以及智能续写服务。
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                 <span className="text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded-full border border-slate-200 flex items-center gap-1"><Camera size={12}/> 拍照识别</span>
                 <span className="text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded-full border border-slate-200 flex items-center gap-1"><CheckCircle2 size={12}/> 跑题检测</span>
                 <span className="text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded-full border border-slate-200 flex items-center gap-1"><Sparkles size={12}/> 智能续写</span>
              </div>
            </div>
          ) : (
            // 结果展示
            <div className="flex-1 bg-slate-100/50 rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
              
              {/* 结果概览头部 */}
              <div className="bg-white p-6 border-b border-slate-200 shadow-sm z-10">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">分析报告</h2>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-sm text-slate-500">等级: <span className="font-semibold text-indigo-600">{result.level}</span></p>
                      {/* 切题检测标签 */}
                      {result.task_response_check && (
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                          🎯 切题度检测
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* 评分圆环 */}
                  <div className="relative w-14 h-14 flex items-center justify-center">
                     <svg className="w-full h-full transform -rotate-90">
                       <circle cx="28" cy="28" r="24" stroke="#f1f5f9" strokeWidth="4" fill="none" />
                       <circle 
                        cx="28" cy="28" r="24" 
                        stroke={result.score > 80 ? "#22c55e" : result.score > 60 ? "#eab308" : "#ef4444"} 
                        strokeWidth="4" 
                        fill="none" 
                        strokeDasharray={2 * Math.PI * 24}
                        strokeDashoffset={2 * Math.PI * 24 * (1 - result.score / 100)}
                        className="transition-all duration-1000 ease-out"
                       />
                     </svg>
                     <span className="absolute font-bold text-slate-700 text-sm">{result.score}</span>
                  </div>
                </div>

                {/* 切题程度简评 */}
                {result.task_response_check && (
                   <div className="mb-3 text-xs bg-orange-50 text-orange-800 p-2 rounded border border-orange-100 flex gap-2 items-start">
                     <span className="font-bold flex-shrink-0">🎯 跑题检测:</span>
                     <span>{result.task_response_check}</span>
                   </div>
                )}
                
                {/* AI 点评 */}
                <div className="bg-indigo-50 p-3 rounded-lg text-sm text-indigo-800 leading-relaxed border border-indigo-100">
                  <span className="font-bold mr-1">🤖 教练点评:</span>
                  {result.summary}
                </div>
              </div>

              {/* 选项卡导航 */}
              <div className="flex border-b border-slate-200 bg-white overflow-x-auto">
                <button 
                  onClick={() => setActiveTab('editor')}
                  className={`flex-1 min-w-[90px] py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'editor' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  <Highlighter size={14} className="inline mr-1.5 mb-0.5" />
                  批改
                </button>
                <button 
                  onClick={() => setActiveTab('vocab')}
                  className={`flex-1 min-w-[90px] py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'vocab' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  <GraduationCap size={14} className="inline mr-1.5 mb-0.5" />
                  词汇
                </button>
                <button 
                  onClick={() => setActiveTab('revised')}
                  className={`flex-1 min-w-[90px] py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'revised' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  <CheckCircle2 size={14} className="inline mr-1.5 mb-0.5" />
                  润色
                </button>
              </div>

              {/* 滚动区域 */}
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                
                {/* 1. 批改详情 */}
                {activeTab === 'editor' && (
                   <div className="space-y-2">
                     {(!result.corrections || result.corrections.length === 0) ? (
                       <div className="text-center text-slate-400 py-10">
                         <CheckCircle2 size={48} className="mx-auto mb-3 text-green-200" />
                         <p>完美！没有发现明显的语法错误。</p>
                       </div>
                     ) : (
                       result.corrections.map((item, idx) => (
                         <CorrectionCard key={idx} item={item} />
                       ))
                     )}
                   </div>
                )}

                {/* 2. 词汇升级 */}
                {activeTab === 'vocab' && (
                  <div className="space-y-2">
                     {(!result.vocabulary_enhancements || result.vocabulary_enhancements.length === 0) ? (
                       <div className="text-center text-slate-400 py-10">
                         <GraduationCap size={48} className="mx-auto mb-3 text-blue-200" />
                         <p>您的用词已经很棒了，或者文章太短暂无建议。</p>
                       </div>
                     ) : (
                       <>
                        <div className="text-xs text-slate-400 mb-2 text-center">点击单词可查看详细用法 (模拟)</div>
                        {result.vocabulary_enhancements.map((item, idx) => (
                          <VocabCard key={idx} item={item} />
                        ))}
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
                        onClick={() => {
                          navigator.clipboard.writeText(result.improved_full_text);
                          alert("已复制到剪贴板");
                        }}
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