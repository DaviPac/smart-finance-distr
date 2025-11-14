package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type User struct {
	UID   string `json:"uid"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

type firebaseAuthResponse struct {
	IDToken      string `json:"idToken"`
	Email        string `json:"email"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    string `json:"expiresIn"`
	LocalID      string `json:"localId"`
}

func (app *AppConfig) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "JSON inválido", http.StatusBadRequest)
		return
	}

	restURL := fmt.Sprintf("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=%s", app.APIKey)

	fbReqBody, _ := json.Marshal(map[string]any{
		"email":             req.Email,
		"password":          req.Password,
		"returnSecureToken": true,
	})

	resp, err := http.Post(restURL, "application/json", bytes.NewBuffer(fbReqBody))
	if err != nil || resp.StatusCode != http.StatusOK {
		http.Error(w, "Erro ao criar usuário no Firebase Auth", http.StatusInternalServerError)
		return
	}

	var fbResp firebaseAuthResponse
	json.NewDecoder(resp.Body).Decode(&fbResp)

	userData := User{
		UID:   fbResp.LocalID,
		Email: req.Email,
		Name:  req.Name,
	}

	ref := app.DBClient.NewRef("users/" + userData.UID)
	if err := ref.Set(r.Context(), userData); err != nil {
		http.Error(w, "Erro ao salvar dados do usuário no RTDB", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(userData)
}

func (app *AppConfig) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "JSON inválido", http.StatusBadRequest)
		return
	}

	restURL := fmt.Sprintf("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=%s", app.APIKey)

	fbReqBody, _ := json.Marshal(map[string]any{
		"email":             req.Email,
		"password":          req.Password,
		"returnSecureToken": true,
	})

	resp, err := http.Post(restURL, "application/json", bytes.NewBuffer(fbReqBody))
	if err != nil || resp.StatusCode != http.StatusOK {
		http.Error(w, "Email ou senha inválidos", http.StatusUnauthorized)
		return
	}

	var fbResp firebaseAuthResponse
	json.NewDecoder(resp.Body).Decode(&fbResp)

	user, err := app.getUserProfile(r.Context(), fbResp.LocalID)
	if err != nil {
		user = &User{
			UID:   fbResp.LocalID,
			Email: fbResp.Email,
			Name:  "Usuario",
		}
		ref := app.DBClient.NewRef("users/" + user.UID)
		if err := ref.Set(r.Context(), user); err != nil {
			http.Error(w, "Erro ao criar perfil do usuário", http.StatusInternalServerError)
			return
		}
	}

	tokenString, err := app.createJWT(user.UID)
	if err != nil {
		http.Error(w, "Erro ao criar token de sessão", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    tokenString,
		Expires:  time.Now().Add(24 * time.Hour),
		HttpOnly: true,
		Secure:   false,
		Path:     "/",
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"user":  user,
		"token": tokenString,
	})
}

func (app *AppConfig) handleGetMe(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}

	user, err := app.getUserProfile(r.Context(), uid)
	if err != nil {
		http.Error(w, "Perfil do usuário não encontrado", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (app *AppConfig) handleGetUser(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	if uid == "" {
		http.Error(w, "UID do usuário não fornecido", http.StatusBadRequest)
		return
	}
	user, err := app.getUserProfile(r.Context(), uid)
	if err != nil {
		http.Error(w, "Perfil do usuário não encontrado", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (app *AppConfig) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    "",
		Expires:  time.Now().Add(-1 * time.Hour),
		HttpOnly: true,
		Secure:   false,
		Path:     "/",
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Logout realizado com sucesso"})
}

func (app *AppConfig) getUserProfile(ctx context.Context, uid string) (*User, error) {
	ref := app.DBClient.NewRef("users/" + uid)
	var user User
	if err := ref.Get(ctx, &user); err != nil {
		return nil, err
	}
	if user.UID == "" {
		return nil, fmt.Errorf("usuário não encontrado")
	}
	return &user, nil
}

func (app *AppConfig) handleGetUsers(w http.ResponseWriter, r *http.Request) {
	ref := app.DBClient.NewRef("users")
	var usersMap map[string]User
	if err := ref.Get(r.Context(), &usersMap); err != nil {
		http.Error(w, "Erro ao buscar usuários", http.StatusInternalServerError)
		return
	}
	usersList := make([]User, 0, len(usersMap))
	for _, user := range usersMap {
		usersList = append(usersList, user)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(usersList)
}
