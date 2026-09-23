import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";

export function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return setError(error.message);
    navigate("/login", { replace: true });
  }

  return (
    <div className="login-form-side">
      <div className="login-card">
        <h2 className="login-title">Set a new password</h2>
        <form onSubmit={handleSubmit}>
          <Field label="New Password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" className="login-submit">Update password</Button>
        </form>
        {error && <Banner tone="error" title={error} />}
      </div>
    </div>
  );
}