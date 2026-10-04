
import React, { useEffect, useRef } from 'react';
import type { TranscriptMessage } from '../types';

interface ChatLogProps {
    history: TranscriptMessage[];
    kokoTranscript: string;
    nexusTranscript: string;
}

export const ChatLog: React.FC<ChatLogProps> = ({ history, kokoTranscript, nexusTranscript }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [history, kokoTranscript, nexusTranscript]);

    return (
        <div 
            ref={scrollRef}
            className="absolute bottom-0 left-0 right-0 h-1/2 p-4 sm:p-8 md:p-12 overflow-y-auto pointer-events-auto"
            style={{
                maskImage: 'linear-gradient(to top, black 80%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to top, black 80%, transparent 100%)',
            }}
        >
            <div className="flex flex-col gap-4 max-w-4xl mx-auto">
                {history.map((msg, index) => (
                    <div key={index} className={`flex ${msg.speaker === 'Koko' ? 'justify-end' : 'justify-start'}`}>
                        <div 
                            className={`p-3 rounded-2xl max-w-[80%] animate-fade-in-up text-lg ${
                                msg.speaker === 'Koko' 
                                ? 'bg-sky-500/30 text-sky-100 rounded-br-none' 
                                : 'bg-fuchsia-500/30 text-fuchsia-100 rounded-bl-none'
                            }`}
                        >
                            {msg.text}
                        </div>
                    </div>
                ))}
                {kokoTranscript && (
                     <div className="flex justify-end">
                        <div className="p-3 rounded-2xl max-w-[80%] bg-sky-500/30 text-sky-100/80 rounded-br-none text-lg italic">
                            {kokoTranscript}
                        </div>
                    </div>
                )}
                 {nexusTranscript && (
                     <div className="flex justify-start">
                        <div className="p-3 rounded-2xl max-w-[80%] bg-fuchsia-500/30 text-fuchsia-100/80 rounded-bl-none text-lg italic">
                            {nexusTranscript}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
