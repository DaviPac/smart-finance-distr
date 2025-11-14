package main

import (
	"context"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userUIDKey contextKey = "userUID"

type SessionClaims struct {
	UID string `json:"uid"`
	jwt.RegisteredClaims
}

func (app *AppConfig) createJWT(uid string) (string, error) {
	claims := SessionClaims{
		UID: uid,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(app.JWTSecret)
}

func (app *AppConfig) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		cookie, err := r.Cookie("session_token")
		if err != nil {
			http.Error(w, "Não autorizado: Token não encontrado", http.StatusUnauthorized)
			return
		}

		tokenString := cookie.Value
		claims := &SessionClaims{}

		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
			return app.JWTSecret, nil
		})

		if err != nil || !token.Valid {
			http.Error(w, "Não autorizado: Token inválido", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), userUIDKey, claims.UID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
