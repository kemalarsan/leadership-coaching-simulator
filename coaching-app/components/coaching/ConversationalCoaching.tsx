'use client';

import { useState, useEffect, useRef } from 'react';
import { useCoaching, CoachAttitude } from '@/lib/context/CoachingContext';
import { Message, CoachingState } from '@/lib/services/aiCoach';
import ChatInterface from './ChatInterface';
import { SubDimension, MainDimension } from '@/types/coaching';

const STAGE_TITLES: Record<number, string> = {
  3: 'Guclu Ozellikler',
  4: 'Gelisim Alanlari',
  5: 'Eylem Plani',
  6: 'Ozet ve Kapanis',
};

export default function ConversationalCoaching() {
  const { session, previousStage, coachAttitude, setCoachAttitude } = useCoaching();
  const [messages, setMessages] = useState<Message[]>([]);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [coachingState, setCoachingState] = useState<CoachingState | null>(null);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const initializedStage = useRef<number | null>(null);
  const isSendingMessage = useRef<boolean>(false);

  // Extract currentStage to use in dependency array
  const currentStage = session?.currentStage;

  useEffect(() => {
    console.log('🔵 useEffect triggered - currentStage:', currentStage);
    
    if (!session || currentStage === undefined) return;
    
    if (initializedStage.current === currentStage) {
      console.log('⏭️ Stage already initialized, skipping');
      return;
    }

    console.log('✅ Initializing stage:', currentStage);
    initializedStage.current = currentStage;

    const initialState: CoachingState = {
      stage: currentStage as CoachingState['stage'],
      participantName: session.participantName,
      scores: session.profile?.scores as Record<SubDimension, number>,
      mainScores: session.profile?.mainDimensionScores as Record<MainDimension, number>,
      strengths: session.strengths?.map(s => s.dimension),
      developmentAreas: session.developmentAreas?.map(d => d.dimension),
      conversationHistory: [],
    };
    setCoachingState(initialState);

    if (currentStage >= 3) {
      const stageMarker: Message = {
        role: 'system',
        content: `--- ${STAGE_TITLES[currentStage]} ---`
      };
      setAllMessages(prev => [...prev, stageMarker]);
    }

    sendInitialMessage(initialState);
  }, [currentStage]);

  const sendInitialMessage = async (state: CoachingState) => {
    // Eğer zaten mesaj gönderiliyorsa, çıkış yap!
    if (isSendingMessage.current) {
      console.log('⏭️ Already sending initial message, skipping duplicate call');
      return;
    }

    isSendingMessage.current = true; // Lock!
    console.log('📤 Sending initial message for stage:', state.stage);
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Basla',
          state,
          attitude: coachAttitude,
        }),
      });

      if (!response.ok) throw new Error('Failed to get response');

      const data = await response.json();
      console.log('📥 Received response for stage:', state.stage);

      const assistantMsg: Message = { role: 'assistant', content: data.response };
      setMessages([assistantMsg]);
      setAllMessages(prev => [...prev, assistantMsg]);
      setCoachingState(data.state);

      if (data.state.stage === 6) {
        setSessionComplete(true);
      }
    } catch (error) {
      console.error('Error getting initial message:', error);
      setMessages([{
        role: 'assistant',
        content: 'Bir hata olustu. Lutfen sayfayi yenileyin.'
      }]);
    } finally {
      setIsLoading(false);
      isSendingMessage.current = false; // Unlock!
      console.log('✅ Initial message sent, lock released');
    }
  };

  const handleSendMessage = async (userMessage: string) => {
    if (!coachingState) return;

    const userMsg: Message = { role: 'user', content: userMessage };
    const updatedMessages: Message[] = [...messages, userMsg];
    setMessages(updatedMessages);
    setAllMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const stateWithHistory: CoachingState = {
        ...coachingState,
        conversationHistory: updatedMessages,
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          state: stateWithHistory,
          attitude: coachAttitude,
        }),
      });

      if (!response.ok) throw new Error('Failed to get response');

      const data = await response.json();
      const assistantMsg: Message = { role: 'assistant', content: data.response };

      if (data.state.stage !== coachingState.stage) {
        // ÖZEL DURUM: Stage 2'ye dönüş (puanları düzeltmek için)
        if (data.state.stage === 2 && coachingState.stage > 2) {
          console.log('🔙 Returning to Stage 2 to edit scores');
          previousStage(); // Context'i güncelle!
        }
        // Diğer stage geçişleri için Context güncelleme YAPMA (duplike request önlemi)
        
        console.log('🔄 Stage changed from', coachingState.stage, 'to', data.state.stage);
        
        setMessages([assistantMsg]);

        const stageMarker: Message = {
          role: 'system',
          content: `--- ${STAGE_TITLES[data.state.stage]} ---`
        };
        setAllMessages(prev => [...prev, stageMarker, assistantMsg]);
      } else {
        setMessages([...updatedMessages, assistantMsg]);
        setAllMessages(prev => [...prev, assistantMsg]);
      }

      setCoachingState(data.state);

      if (data.state.stage === 6) {
        setSessionComplete(true);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMsg: Message = { role: 'assistant', content: 'Bir hata olustu. Lutfen tekrar deneyin.' };
      setMessages([...updatedMessages, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const downloadConversation = () => {
    if (!session) return;

    const date = new Date().toLocaleDateString('tr-TR');
    let markdown = `# 5D Kisilik Kocluk Seansi\n\n`;
    markdown += `**Katilimci:** ${session.participantName}\n`;
    markdown += `**Tarih:** ${date}\n\n`;

    if (session.profile?.scores) {
      markdown += `## Kisilik Puanlari\n\n`;
      const dimensionNames: Record<string, string> = {
        duygu_kontrolu: 'Duygu Kontrolu',
        stresle_basa_cikma: 'Stresle Basa Cikma',
        ozguven: 'Ozguven',
        risk_duyarlilik: 'Risk Duyarlilik',
        kontrolculuk: 'Kontrolculuk',
        kural_uyumu: 'Kural Uyumu',
        one_cikmayi_seven: 'One Cikmayi Seven',
        sosyallik: 'Sosyallik',
        basari_yonelimi: 'Basari Yonelimi',
        iliski_yonetimi: 'Iliski Yonetimi',
        iyi_gecinme: 'Iyi Gecinme',
        kacinma: 'Kacinma',
        yenilikcilik: 'Yenilikcilik',
        ogrenme_yonelimi: 'Ogrenme Yonelimi',
        merak: 'Merak',
      };
      Object.entries(session.profile.scores).forEach(([key, value]) => {
        markdown += `- **${dimensionNames[key] || key}:** ${value}\n`;
      });
      markdown += `\n`;
    }

    markdown += `## Konusma\n\n`;

    allMessages.forEach((msg) => {
      if (msg.role === 'system') {
        markdown += `\n${msg.content}\n\n`;
      } else if (msg.role === 'user') {
        markdown += `**${session.participantName}:** ${msg.content}\n\n`;
      } else {
        markdown += `**Koc:** ${msg.content}\n\n`;
      }
    });

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `5D-Kocluk-${session.participantName}-${date.replace(/\./g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAttitudeChange = (key: keyof CoachAttitude, value: number) => {
    setCoachAttitude({ ...coachAttitude, [key]: value });
  };

  if (!session) return null;

  // Use local coachingState for current stage if available
  const displayStage = coachingState?.stage || currentStage;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 max-w-4xl">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                5D Kisilik Kocluk
              </h1>
              <p className="text-sm text-gray-600">
                {session.participantName} - {STAGE_TITLES[displayStage!] || `Asama ${displayStage}`}
              </p>
            </div>

            <div className="flex items-center space-x-4">
              {/* Settings Button */}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-1"
                title="Koc Ayarlari"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {/* Download Button */}
              {sessionComplete && (
                <button
                  onClick={downloadConversation}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>Indir</span>
                </button>
              )}

              {/* Stage Progress */}
              <div className="flex items-center space-x-2">
                {[3, 4, 5, 6].map((stage) => (
                  <div
                    key={stage}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                      ${displayStage === stage
                        ? 'bg-purple-600 text-white'
                        : displayStage! > stage
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                  >
                    {displayStage! > stage ? '✓' : stage}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Settings Panel (TARS-style) */}
          {showSettings && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Koc Ayarlari (TARS Modu)</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Dogrudan Konusma</span>
                    <span>{coachAttitude.directness}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={coachAttitude.directness}
                    onChange={(e) => handleAttitudeChange('directness', parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>Yumusak</span>
                    <span>Dogrudan</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Zorlama Seviyesi</span>
                    <span>{coachAttitude.challengeLevel}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={coachAttitude.challengeLevel}
                    onChange={(e) => handleAttitudeChange('challengeLevel', parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>Kabul Edici</span>
                    <span>Zorlayici</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Gelisim Odagi</span>
                    <span>{coachAttitude.growthFocus}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={coachAttitude.growthFocus}
                    onChange={(e) => handleAttitudeChange('growthFocus', parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>Guclu Yanlar</span>
                    <span>Gelisim Alanlari</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Bu ayarlar kocun konusma tarzini etkiler. Yuksek degerler daha dogrudan ve zorlayici bir yaklasim saglar.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 container mx-auto max-w-4xl">
        <ChatInterface
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
