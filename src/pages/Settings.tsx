import { supabase } from "../lib/supabase";

export default function SettingsPage() {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>Setări (v0.0)</div>

      <button
        onClick={async () => {
          const { data } = await supabase.auth.getSession();
          alert(data.session ? "Session OK" : "No session");
        }}
        style={{ width: 220, padding: 10, borderRadius: 10 }}
      >
        Test session
      </button>
    </div>
  );
}
