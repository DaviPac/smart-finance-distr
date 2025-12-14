package main

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userUIDKey contextKey = "userUID"

type SessionClaims struct {
	UID string `json:"uid"`
	jwt.RegisteredClaims
}

func (app *AppConfig) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, "Não autorizado: Token não encontrado", http.StatusUnauthorized)
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
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
