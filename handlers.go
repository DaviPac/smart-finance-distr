package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

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

type PaymentRequest struct {
	TargetId string  `json:"targetId"`
	Value    float64 `json:"value"`
}

type GroupRequest struct {
	Name string `json:"name"`
}

type ExpenseRequest struct {
	Category    string  `json:"category"`
	Description string  `json:"description"`
	Value       float64 `json:"value"`
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

func (app *AppConfig) handlePostGroup(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	var req GroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "JSON inválido", http.StatusBadRequest)
		return
	}
	groupsRef := app.DBClient.NewRef("groups")
	newGroupRef, err := groupsRef.Push(r.Context(), nil)
	if err != nil {
		http.Error(w, "Erro ao criar grupo", http.StatusInternalServerError)
		return
	}
	groupUID := newGroupRef.Key
	groupRef := app.DBClient.NewRef("groups/" + groupUID)
	groupData := Group{
		CreatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		Description: "",
		Expenses:    map[string]Expense{},
		MemberIds:   map[string]bool{uid: true},
		Name:        req.Name,
		OwnerId:     uid,
		Payments:    map[string]Payment{},
		Id:          groupUID,
	}
	if err = groupRef.Set(r.Context(), groupData); err != nil {
		http.Error(w, "Erro ao criar grupo", http.StatusInternalServerError)
		return
	}
	userGroupsRef := app.DBClient.NewRef("user_groups/" + uid)
	if err = userGroupsRef.Update(r.Context(), map[string]any{
		groupUID: true,
	}); err != nil {
		http.Error(w, "Erro ao criar grupo", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groupData)
}

func (app *AppConfig) handleJoinGroup(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	groupUID := chi.URLParam(r, "uid")
	userGroupsRef := app.DBClient.NewRef("user_groups/" + uid)
	userGroupsRef.Update(r.Context(), map[string]any{
		groupUID: true,
	})
	groupMembersRef := app.DBClient.NewRef("groups/" + groupUID + "/memberIds")
	groupMembersRef.Update(r.Context(), map[string]any{
		uid: true,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(true)
}

func (app *AppConfig) handlePostExpense(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	var req ExpenseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "JSON inválido", http.StatusBadRequest)
		return
	}
	groupUID := chi.URLParam(r, "uid")
	expensesRef := app.DBClient.NewRef("groups/" + groupUID + "/expenses")
	newExpenseRef, err := expensesRef.Push(r.Context(), nil)
	if err != nil {
		http.Error(w, "Erro ao criar despesa", http.StatusInternalServerError)
		return
	}
	expenseUID := newExpenseRef.Key
	expenseRef := app.DBClient.NewRef("groups/" + groupUID + "/expenses/" + expenseUID)
	expenseData := Expense{
		Category:    req.Category,
		Date:        float64(time.Now().UnixMilli()),
		Description: req.Description,
		GroupId:     groupUID,
		Id:          expenseUID,
		PayerId:     uid,
		Value:       req.Value,
	}
	if err = expenseRef.Set(r.Context(), expenseData); err != nil {
		http.Error(w, "Erro ao criar despesa", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(expenseData)
}

func (app *AppConfig) handleDeleteExpense(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	groupUID := chi.URLParam(r, "uid")
	expenseUID := chi.URLParam(r, "expenseId")
	if groupUID == "" || expenseUID == "" {
		http.Error(w, "Parâmetros inválidos", http.StatusBadRequest)
		return
	}
	path := "groups/" + groupUID + "/expenses/" + expenseUID
	expenseRef := app.DBClient.NewRef(path)
	var expenseData Expense
	err := expenseRef.Get(r.Context(), &expenseData)
	if err != nil {
		http.Error(w, "Erro ao procurar despesa", http.StatusInternalServerError)
		return
	}
	if uid != expenseData.PayerId {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	if err := expenseRef.Delete(r.Context()); err != nil {
		http.Error(w, "Erro ao deletar despesa", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (app *AppConfig) handlePostPayment(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	var req PaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "JSON inválido", http.StatusBadRequest)
		return
	}
	groupUID := chi.URLParam(r, "uid")
	paymentsRef := app.DBClient.NewRef("groups/" + groupUID + "/payments")
	newPaymentRef, err := paymentsRef.Push(r.Context(), nil)
	if err != nil {
		http.Error(w, "Erro ao criar pagamento", http.StatusInternalServerError)
		return
	}
	paymentUID := newPaymentRef.Key
	paymentRef := app.DBClient.NewRef("groups/" + groupUID + "/payments/" + paymentUID)
	paymentData := Payment{
		Date:     time.Now().UTC().Format(time.RFC3339Nano),
		GroupId:  groupUID,
		Id:       paymentUID,
		PayerId:  uid,
		TargetId: req.TargetId,
		Value:    req.Value,
	}
	if err = paymentRef.Set(r.Context(), paymentData); err != nil {
		http.Error(w, "Erro ao criar pagamento", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(paymentData)
}

func (app *AppConfig) handleDeletePayment(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	groupUID := chi.URLParam(r, "uid")
	paymentUID := chi.URLParam(r, "paymentId")
	if groupUID == "" || paymentUID == "" {
		http.Error(w, "Parâmetros inválidos", http.StatusBadRequest)
		return
	}
	path := "groups/" + groupUID + "/payments/" + paymentUID
	paymentRef := app.DBClient.NewRef(path)
	var paymentData Payment
	err := paymentRef.Get(r.Context(), &paymentData)
	if err != nil {
		http.Error(w, "Erro ao procurar pagamento", http.StatusInternalServerError)
		return
	}
	if uid != paymentData.PayerId {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	if err := paymentRef.Delete(r.Context()); err != nil {
		http.Error(w, "Erro ao deletar pagamento", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
