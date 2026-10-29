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

/** Set your profile picture (a JPEG or PNG, up to 2 MB). Resolves to the picture's URL. */
export async function uploadAvatar(file) {
  const fd = new FormData();
  fd.append("photo", file);
  const { data } = await apiClient.post("/api/me/avatar", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.avatarUrl;
}

/** Remove your profile picture. */
export async function removeAvatar() {
  await apiClient.delete("/api/me/avatar");
}
