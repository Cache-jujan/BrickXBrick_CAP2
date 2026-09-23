import { useState } from "react";
import { apiClient } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    await apiClient.post("/api/auth/forgot-password", { email });
    setSent(true);
  }

  return (
    <div className="login-form-side">
      <div className="login-card">
        <h2 className="login-title">Reset your password</h2>
        {sent ? (
          <Banner tone="info" title="Check your email">
            If that address exists, a reset link is on its way.
          </Banner>
        ) : (
          <form onSubmit={handleSubmit}>
            <Field label="Email Address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" className="login-submit">Send reset link</Button>
          </form>
        )}
      </div>
    </div>
  );
}