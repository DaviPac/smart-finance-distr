package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type Group struct {
	CreatedAt   string             `json:"createdAt"`
	Description string             `json:"description"`
	Expenses    map[string]Expense `json:"expenses"`
	MemberIds   map[string]bool    `json:"memberIds"`
	Name        string             `json:"name"`
	OwnerId     string             `json:"ownerId"`
	Payments    map[string]Payment `json:"payments"`
	Id          string             `json:"id"`
}

type Expense struct {
	Category    string  `json:"category"`
	Date        float64 `json:"date"`
	Description string  `json:"description"`
	GroupId     string  `json:"groupId"`
	Id          string  `json:"id"`
	PayerId     string  `json:"payerId"`
	Value       float64 `json:"value"`
}

type Payment struct {
	Date     string  `json:"date"`
	GroupId  string  `json:"groupId"`
	Id       string  `json:"id"`
	PayerId  string  `json:"payerId"`
	TargetId string  `json:"targetId"`
	Value    float64 `json:"value"`
}

func (app *AppConfig) handleGetMyGroups(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	ref := app.DBClient.NewRef("user_groups/" + uid)
	var userGroupsMap map[string]bool
	if err := ref.Get(r.Context(), &userGroupsMap); err != nil {
		http.Error(w, "Erro ao buscar grupos", http.StatusInternalServerError)
		return
	}
	groups := make([]Group, 0, len(userGroupsMap))
	for groupId, isActive := range userGroupsMap {
		if isActive {
			if group, err := app.getGroup(r.Context(), groupId); err == nil {
				groups = append(groups, *group)
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groups)
}

func (app *AppConfig) handleGetGroup(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	groupUID := chi.URLParam(r, "uid")
	group, err := app.getGroup(r.Context(), groupUID)
	if err != nil {
		http.Error(w, "Erro ao buscar grupo", http.StatusInternalServerError)
	}
	if !group.MemberIds[uid] {
		http.Error(w, "Nao autorizado", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(group)
}

func (app *AppConfig) getGroup(ctx context.Context, uid string) (*Group, error) {
	ref := app.DBClient.NewRef("groups/" + uid)
	var group Group
	if err := ref.Get(ctx, &group); err != nil {
		fmt.Printf("erro ao buscar grupo %s: %v\n", uid, err)
		return nil, err
	}
	if group.OwnerId == "" {
		fmt.Printf("grupo %s nao encontrado\n", uid)
		return nil, fmt.Errorf("grupo não encontrado")
	}
	return &group, nil
}

func (app *AppConfig) handleJoinGroup(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	groupUID := chi.URLParam(r, "uid")
	userGroupsRef := app.DBClient.NewRef("user_groups/" + uid)
	userGroupsRef.Set(r.Context(), map[string]bool{
		groupUID: true,
	})
	groupMembersRef := app.DBClient.NewRef("groups/" + groupUID + "/memberiDS")
	groupMembersRef.Set(r.Context(), map[string]bool{
		uid: true,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(true)
}
