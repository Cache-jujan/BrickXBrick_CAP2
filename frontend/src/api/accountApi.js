import { apiClient } from "./client";

/** Set your username. The server answers with the "username.role" name others see. */
export async function updateUsername(username) {
  const { data } = await apiClient.patch("/api/me/profile", { username });
  return data.user;
}

/** Change your own password while signed in. */
export async function changePassword(currentPassword, newPassword) {
  await apiClient.post("/api/me/change-password", { currentPassword, newPassword });
}
