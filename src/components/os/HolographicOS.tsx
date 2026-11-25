import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Mic, Plug, Send, Settings2 } from 'lucide-react';
import type { Mission, Artifact, Task } from '../../../server/planner/executionSpine';
import type { Subsystem } from '../../types';
import { api, AuthenticationRequiredError } from '../../lib/serverApi';
import { requestOperatorAccess } from '../../lib/operatorAccess';
import { saveUIState } from '../../lib/supabase';
import { sound } from '../../utils/audio';
import { useServerEvents, type ServerEvent } from '../../hooks/useServerEvents';
import { useLiveCommunication } from '../../lib/liveCommunication';
import { shapeIntelligentSpeech } from '../../voice/speechFeedbackCoordinator';
import HIOCockpit from './HIOCockpit';
import FocusedDecisionCard, { type PendingDecisionItem } from './FocusedDecisionCard';
import LiveCommunicationDock from '../realtime/LiveCommunicationDock';
import LiveCommunicationDrawer from '../realtime/LiveCommunicationDrawer';
import SettingsWindow from './SettingsWindow';
import DiagnosticPanel from './DiagnosticPanel';
import type { SettingsSection } from '../rooms/SettingsRoom';

import MissionControlRoom from '../rooms/MissionControlRoom';
import AICoreRoom from '../rooms/AICoreRoom';
import AgentsRoom from '../rooms/AgentsRoom';
import SandboxRoom from '../rooms/SandboxRoom';
import WorkspaceRoom from '../rooms/WorkspaceRoom';
import InfraRoom from '../rooms/InfraRoom';
import TelemetryPanel from '../rooms/TelemetryPanel';
import MemoryRoom from '../rooms/MemoryRoom';
import LearningRoom from '../rooms/LearningRoom';
import AutomationRoom from '../rooms/AutomationRoom';
import AutonomyRoom from '../rooms/AutonomyRoom';
import SupabaseRoom from '../rooms/SupabaseRoom';
import ConstitutionalRoom from '../rooms/ConstitutionalRoom';
import FederationRoom from '../rooms/FederationRoom';
import BibleRoom from '../rooms/BibleRoom';
import WorldThinkingOversightRoom from '../rooms/WorldThinkingOversightRoom';
import PlaywrightRoom from '../rooms/PlaywrightRoom';

interface Props {
  onReboot?: () => void;
}

type CommandState = 'READY' | 'PROCESSING' | 'COMPLETE' | 'ERROR';
type CommandMode = 'auto' | 'mission' | 'chat';

const ROOM_LABELS: Record<Subsystem, string> = {
  mission_control: 'Mission Control',
  ai_core: 'AI Core',
  agents: 'Agents',
  sandbox: 'Sandbox',
  workspace: 'Workspace',
  infra: 'Infrastructure',
  telemetry: 'Telemetry',
  memory: 'Memory',
  learning: 'Learning',
  automation: 'Automation',
  autonomy: 'Autonomy',
  supabase: 'Supabase',
  governance: 'Governance',
  federation: 'Federation',
  world_thinking: 'World Thinking',
  bible: 'System Reference',
  playwright: 'Browser Automation',
};

export default function HolographicOS({ onReboot }: Props) {
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [activeTool, setActiveTool] = useState<Subsystem | null>(null);
  const [commandInput, setCommandInput] = useState('');
  const [commandState, setCommandState] = useState<CommandState>('READY');
  const [lastOutput, setLastOutput] = useState('System ready. Tell me what you want done — I will handle routine work automatically and only pause for approvals or missing details.');
  const [showFullOutput, setShowFullOutput] = useState(false);
  const catalogInitialized = useRef(false);
  const submission = useRef<{ signature: string; key: string } | null>(null);
  const [missionId, setMissionId] = useState('');
  const [mode, setMode] = useState<CommandMode>('auto');
  const [tools, setTools] = useState<{ name: string; description: string }[]>([]);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [origins, setOrigins] = useState('');
  const [missionStatus, setMissionStatus] = useState('');
  const [lastCommand, setLastCommand] = useState('');
  const [serverDecisions, setServerDecisions] = useState<PendingDecisionItem[]>([]);
  const [missingDecisions, setMissingDecisions] = useState<PendingDecisionItem[]>([]);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);

  const { setDrawerOpen, speakAdaptiveBrief, handleProactiveServerEvent } = useLiveCommunication();

  const pendingDecisions = useMemo(
    () => [...missingDecisions, ...serverDecisions],
    [missingDecisions, serverDecisions],
  );

  const shapedOutput = useMemo(
    () => shapeIntelligentSpeech({ text: lastOutput, maxSummaryChars: 260 }),
    [lastOutput],
  );

  const refreshPendingDecisions = useCallback(async () => {
    if (
      !sessionStorage.getItem('microfixd_operator_token') &&
      !sessionStorage.getItem('microfixd_supabase_access_token')
    ) {
      setServerDecisions([]);
      return;
    }
    try {
      const res = await api<{ decisions: PendingDecisionItem[] }>('GET', '/decisions/pending');
      setServerDecisions(Array.isArray(res.decisions) ? res.decisions : []);
    } catch {
      // Leave existing queue if backend temporarily unavailable
    }
  }, []);

  const onServerEvent = useCallback(
    (event: ServerEvent) => {
      handleProactiveServerEvent(event);
      if (
        event.type === 'hitl:review_required' ||
        event.type === 'mission:completed' ||
        event.type === 'mission:failed' ||
        event.type.startsWith('approval')
      ) {
        void refreshPendingDecisions();
      }
    },
    [handleProactiveServerEvent, refreshPendingDecisions],
  );

  useServerEvents(onServerEvent);

  useEffect(() => {
    void refreshPendingDecisions();
    const timer = window.setInterval(() => void refreshPendingDecisions(), 15000);
    window.addEventListener('microfixd:auth-changed', refreshPendingDecisions);
    return () => {
      clearInterval(timer);
      window.removeEventListener('microfixd:auth-changed', refreshPendingDecisions);
    };
  }, [refreshPendingDecisions]);

  useEffect(() => {
    const openAccess = () => setSettingsSection('general');
    const openSettings = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setSettingsSection('general');
      }
      if (event.key === 'Escape' && activeTool) {
        event.preventDefault();
        setActiveTool(null);
      }
    };

    window.addEventListener('microfixd:auth-required', openAccess);
    window.addEventListener('keydown', openSettings);
    return () => {
      window.removeEventListener('microfixd:auth-required', openAccess);
      window.removeEventListener('keydown', openSettings);
    };
  }, [activeTool]);

  const openSettings = (section: SettingsSection = 'general') => {
    setSettingsSection(section);
  };

  const openTool = (tool: Subsystem) => {
    setActiveTool(tool);
    setSettingsSection(null);
  };

  const renderTool = () => {
    switch (activeTool) {
      case 'mission_control': return <MissionControlRoom initialMissionId={missionId} />;
      case 'ai_core': return <AICoreRoom />;
      case 'agents': return <AgentsRoom />;
      case 'sandbox': return <SandboxRoom />;
      case 'workspace': return <WorkspaceRoom />;
      case 'infra': return <InfraRoom />;
      case 'telemetry': return <TelemetryPanel />;
      case 'memory': return <MemoryRoom />;
      case 'learning': return <LearningRoom />;
      case 'automation': return <AutomationRoom />;
      case 'autonomy': return <AutonomyRoom />;
      case 'supabase': return <SupabaseRoom />;
      case 'governance': return <ConstitutionalRoom />;
      case 'federation': return <FederationRoom />;
      case 'world_thinking': return <WorldThinkingOversightRoom />;
      case 'bible': return <BibleRoom />;
      case 'playwright': return <PlaywrightRoom />;
      default: return null;
    }
  };

  useEffect(() => {
    let stopped = false;
    const refreshCatalog = () =>
      void api<{ tools: { name: string; description: string }[] }>('GET', '/planner/tools')
        .then((result) => {
          if (!stopped) {
            setTools(result.tools);
            if (!catalogInitialized.current) {
              setAllowedTools(result.tools.map((t) => t.name));
              catalogInitialized.current = true;
            }
          }
        })
        .catch((error) => {
          if (!stopped) setLastOutput(`Tool catalog unavailable: ${error.message}`);
        });
    refreshCatalog();
    window.addEventListener('microfixd:auth-changed', refreshCatalog);
    return () => {
      stopped = true;
      window.removeEventListener('microfixd:auth-changed', refreshCatalog);
    };
  }, []);

  useEffect(() => {
    if (!missionId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const detail = await api<{
          mission: Mission;
          tasks: Task[];
          artifacts: Artifact[];
          approvals: { status: string }[];
          errors: { code: string }[];
        }>('GET', `/planner/missions/${missionId}`);
        if (stopped) return;
        const status = detail.mission.status;
        setMissionStatus(status);
        const final = detail.artifacts.find((a) => a.artifact_id === detail.mission.result_artifact_id);
        const output = final
          ? typeof final.content === 'string'
            ? final.content
            : JSON.stringify(final.content)
          : detail.approvals.some((a) => a.status === 'pending')
            ? 'Waiting for approval. Open this mission to review the exact action.'
            : status === 'waiting'
              ? `Mission paused: ${detail.errors.map((e) => e.code).join(', ') || 'see mission details'}. Open this mission for recovery details.`
              : status === 'failed'
                ? `Mission failed: ${detail.errors.map((e) => e.code).join(', ') || 'see mission details'}. Open this mission for persisted results and recovery details.`
                : `${status}: ${detail.tasks.filter((t) => t.status === 'succeeded').length}/${detail.tasks.length} tasks completed.`;
        setLastOutput(output);
        setShowFullOutput(false);

        if (detail.approvals.some((a) => a.status === 'pending')) {
          void refreshPendingDecisions();
        }

        if (status === 'succeeded' || status === 'failed') {
          setCommandState(status === 'succeeded' ? 'COMPLETE' : 'ERROR');
          void speakAdaptiveBrief({
            text: output,
            title: detail.mission.objective,
            source: 'mission',
            urgency: status === 'failed' ? 'high' : 'normal',
          });
          void refreshPendingDecisions();
          return;
        }
        timer = setTimeout(() => void refresh(), 3000);
      } catch (error) {
        if (!stopped) {
          setLastOutput(
            `Mission status unavailable: ${error instanceof Error ? error.message : String(error)}. Open this mission to retry; it has not been resubmitted.`,
          );
          timer = setTimeout(() => void refresh(), 5000);
        }
      }
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [missionId, refreshPendingDecisions, speakAdaptiveBrief]);

  const executeGoal = async (rawTask: string, overrideMode?: CommandMode) => {
    const task = rawTask.trim();
    if (!task || commandState === 'PROCESSING') return;

    const targetMode = overrideMode ?? mode;
    setLastCommand(task);
    setLastOutput('Working on your request…');
    setShowFullOutput(false);
    setCommandState('PROCESSING');
    setCommandInput('');
    sound.playCognitivePulse();

    try {
      const signature = JSON.stringify({ task, allowedTools, origins, targetMode });
      if (submission.current?.signature !== signature) {
        submission.current = { signature, key: crypto.randomUUID() };
      }
      const key = submission.current.key;

      const run = () => {
        if (targetMode === 'mission') {
          return api<Mission>(
            'POST',
            '/planner/missions',
            {
              objective: task,
              tool_permissions: allowedTools,
              browser_origins: origins
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
            },
            { 'Idempotency-Key': key },
          );
        }
        if (targetMode === 'chat') {
          return api<any>('POST', '/command/run', {
            mode: 'chat',
            task,
            source: 'os-shell',
            priority: 'normal',
            context: { surface: 'holographic-os' },
          });
        }
        return api<any>(
          'POST',
          '/command/auto',
          {
            mode: 'auto',
            task,
            source: 'os-home',
            context: { surface: 'holographic-os' },
          },
          { 'Idempotency-Key': key },
        );
      };

      let result;
      try {
        result = await run();
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) {
          await requestOperatorAccess();
          result = await run();
        } else {
          throw error;
        }
      }

      if (result?.needsInput && result?.decision) {
        submission.current = null;
        setMissingDecisions((prev) => [result.decision as PendingDecisionItem, ...prev.filter((p) => p.id !== result.decision.id)]);
        setLastOutput(String(result.output || result.decision.summary));
        setCommandState('READY');
        void speakAdaptiveBrief({
          text: String(result.output || result.decision.summary),
          source: 'decision',
          urgency: 'high',
        });
        return;
      }

      if (targetMode === 'mission' || result?.mission_id) {
        submission.current = null;
        setMissionId(result.mission_id);
        setMissionStatus(result.status || 'queued');
        setLastOutput(
          targetMode === 'auto'
            ? 'Mission started automatically — tracking durable execution.'
            : 'Mission saved. Waiting for the durable worker.',
        );
        return;
      }

      const output = String(result?.output || result?.message || result?.result || 'Command completed.');
      setLastOutput(output);
      setCommandState(result?.success === false ? 'ERROR' : 'COMPLETE');

      void speakAdaptiveBrief({
        text: output,
        source: targetMode,
        urgency: result?.success === false ? 'high' : 'normal',
      });

      saveUIState({
        last_command: task,
        state_data: {
          lastAnswer: output,
          commandId: result?.cmdId,
          success: result?.success !== false,
          organsUsed: result?.organs_used || result?.organsUsed || [],
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCommandInput(task);
      setLastOutput(message || 'Command execution failed.');
      setCommandState('ERROR');
    }
  };

  const handleCommandSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void executeGoal(commandInput);
  };

  const handleApproveDecision = async (item: PendingDecisionItem, decision: 'approved' | 'rejected') => {
    if (item.kind === 'missing_info') {
      setMissingDecisions((prev) => prev.filter((p) => p.id !== item.id));
      return;
    }
    setDecisionBusyId(item.id);
    try {
      await api('POST', '/decisions/resolve', {
        kind: item.kind,
        decision,
        missionId: item.missionId,
        subtaskId: item.subtaskId,
        requestHash: item.requestHash,
        hitlId: item.hitlId,
      });
      await refreshPendingDecisions();
      void speakAdaptiveBrief({
        text: `${item.title} marked as ${decision}.`,
        source: 'decision',
      });
    } catch (err) {
      setLastOutput(`Decision could not be applied: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDecisionBusyId(null);
    }
  };

  const handleReplyMissingInfo = async (item: PendingDecisionItem, answer: string) => {
    setDecisionBusyId(item.id);
    try {
      const res = await api<any>('POST', '/decisions/resolve', {
        kind: 'missing_info',
        originalTask: item.originalTask,
        answer,
      });
      setMissingDecisions((prev) => prev.filter((p) => p.id !== item.id));
      if (res?.mission_id) {
        setMissionId(res.mission_id);
        setMissionStatus(res.status || 'queued');
        setLastOutput('Got it — continuing your task autonomously.');
      } else if (res?.output) {
        setLastOutput(String(res.output));
        setCommandState('COMPLETE');
        void speakAdaptiveBrief({ text: String(res.output), source: 'decision-reply' });
      }
    } catch (err) {
      setLastOutput(`Could not continue task: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDecisionBusyId(null);
    }
  };

  return (
    <>
      <HIOCockpit
        onOpenTool={openTool}
        onSettings={() => openSettings('general')}
        onReboot={onReboot}
        onQuickGoal={(goalText) => void executeGoal(goalText, 'auto')}
        pendingDecisionCount={pendingDecisions.length}
        commandState={commandState}
      >
        <FocusedDecisionCard
          decisions={pendingDecisions}
          busyId={decisionBusyId}
          onApprove={handleApproveDecision}
          onReplyMissingInfo={handleReplyMissingInfo}
          onOpenMission={(mId) => {
            setMissionId(mId);
            openTool('mission_control');
          }}
        />

        <div className="mb-1.5">
          <LiveCommunicationDock />
        </div>

        <section aria-live="polite" className="hio-output">
          <div className="hio-output-header">
            <span>{commandState}</span>
            <span>{lastCommand || 'MICROFIXD // AUTONOMOUS HOME'}</span>
          </div>
          <div className="hio-answer">
            {showFullOutput || !shapedOutput.hasMore ? lastOutput : shapedOutput.summary}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {shapedOutput.hasMore && (
              <button
                type="button"
                onClick={() => setShowFullOutput((v) => !v)}
                className="inline-flex items-center gap-1 text-[10px] text-cyan-300 hover:underline"
              >
                {showFullOutput ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                <span>{showFullOutput ? 'Show brief summary' : 'Show full output'}</span>
              </button>
            )}
            {missionId && (
              <button
                type="button"
                onClick={() => openTool('mission_control')}
                className="text-[10px] text-cyan-200 hover:underline"
              >
                Open mission • {missionStatus}
              </button>
            )}
          </div>
        </section>

        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
            <span>Command mode</span>
            <select
              aria-label="Command mode"
              value={mode}
              disabled={commandState === 'PROCESSING'}
              onChange={(e) => setMode(e.target.value as CommandMode)}
              className="rounded border border-cyan-500/30 bg-[#04111a] px-2 py-0.5 text-[11px] text-cyan-100"
            >
              <option value="auto">Auto (Handles routine work)</option>
              <option value="mission">Do a task (durable mission)</option>
              <option value="chat">Ask a question</option>
            </select>
          </label>
          {mode === 'mission' && (
            <details className="text-[11px] text-slate-300">
              <summary className="cursor-pointer text-cyan-200">Authorized tool scope ({allowedTools.length} tools)</summary>
              <p className="mt-1 text-slate-400">
                All tools are selected by default. Owner missions use standing authorization; other accounts retain manual approval.
              </p>
              <div className="mt-1 max-h-28 overflow-y-auto rounded border border-white/10 bg-black/40 p-2">
                {tools.map((tool) => (
                  <label key={tool.name} className="block" title={tool.description}>
                    <input
                      type="checkbox"
                      disabled={commandState === 'PROCESSING'}
                      checked={allowedTools.includes(tool.name)}
                      onChange={(e) =>
                        setAllowedTools((prev) =>
                          e.target.checked ? [...prev, tool.name] : prev.filter((n) => n !== tool.name),
                        )
                      }
                    />{' '}
                    {tool.name}
                  </label>
                ))}
              </div>
              <label className="mt-1 block">
                Allowed HTTPS origins
                <input
                  aria-label="Allowed HTTPS origins"
                  disabled={commandState === 'PROCESSING'}
                  value={origins}
                  onChange={(e) => setOrigins(e.target.value)}
                  placeholder="https://example.com"
                  className="ml-2 rounded border border-white/15 bg-black/50 px-2 py-0.5 text-[11px] text-white"
                />
              </label>
            </details>
          )}
        </div>

        <footer className="hio-command-footer">
          <form onSubmit={handleCommandSubmit} className="hio-form">
            <input
              value={commandInput}
              onChange={(event) => setCommandInput(event.target.value)}
              placeholder="Ask anything or describe a goal — routine steps run automatically..."
              aria-label="Microfixd command"
            />
            <button
              type="submit"
              disabled={!commandInput.trim() || commandState === 'PROCESSING'}
              aria-label="Send command"
              title="Send command"
            >
              {commandState === 'PROCESSING' ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
            </button>
            <button
              type="submit"
              disabled={!commandInput.trim() || commandState === 'PROCESSING'}
              aria-label="Execute"
              className="hio-execute-btn"
            >
              Execute
            </button>
          </form>
        </footer>
      </HIOCockpit>

      <DiagnosticPanel />
      <LiveCommunicationDrawer />

      {settingsSection && (
        <SettingsWindow
          initialSection={settingsSection}
          onClose={() => {
            setSettingsSection(null);
            window.dispatchEvent(new Event('microfixd:auth-cancelled'));
          }}
          onNavigate={openTool}
          onReboot={onReboot}
        />
      )}

      {activeTool && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-[#02060b] text-cyan-100">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-cyan-300/15 bg-black/70 px-3 sm:px-5 backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveTool(null)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/5"
              >
                <ArrowLeft size={15} />
                Hologram
              </button>
              <span className="truncate text-xs font-semibold tracking-[0.12em] text-cyan-200">
                {ROOM_LABELS[activeTool]}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(true, 'live')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/20 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-400/10"
              >
                <Mic size={14} />
                <span className="hidden sm:inline">Live Comms</span>
              </button>
              <button
                type="button"
                onClick={() => setDrawerOpen(true, 'connections')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/20 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-400/10"
              >
                <Plug size={14} />
                <span className="hidden sm:inline">Apps &amp; MCP</span>
              </button>
              <button
                type="button"
                onClick={() => openSettings('general')}
                className="rounded-lg border border-cyan-300/20 p-2 text-cyan-200 hover:bg-cyan-400/10"
                aria-label="Open settings"
              >
                <Settings2 size={16} />
              </button>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-hidden">
            {renderTool()}
          </main>
        </div>
      )}
    </>
  );
}
