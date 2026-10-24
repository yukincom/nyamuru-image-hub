import type { AgentPreferences } from '../lib/agentPreferences';

export default function AgentAvatar({profile}:{profile:AgentPreferences}) {
  return <span class="agent-avatar">{profile.avatar
    ?<img src={profile.avatar} alt={`${profile.name}の顔`} draggable={false}/>
    :<span role="img" aria-label={`${profile.name}の顔`}>🐱</span>}</span>;
}
